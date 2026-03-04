/**
 * MongoDB client for saving market results and wallet stats (BTC 5m)
 */

import { MongoClient, Db, Collection } from "mongodb";
import type {
  MarketResult,
  WalletStatsDoc,
  HotWallet,
  MarketPrediction,
  MlBuyDoc,
  RedeemRecordDoc,
} from "../types";

export class MongoDBClient {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<void> {
    const uri = process.env.MONGODB_URI || "mongodb+srv://onlybitcoin:kig020829@cluster0.9koasrn.mongodb.net/?appName=Cluster0";
    const dbName = process.env.MONGODB_DB || "polymarket_btc5";

    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(dbName);

    await this.db.collection("market_results").createIndex({ conditionId: 1 });
    await this.db.collection("market_results").createIndex({ eventSlug: 1 });
    await this.db.collection("market_results").createIndex({ resolvedOutcome: 1, endTime: 1 });
    await this.db.collection("wallet_stats").createIndex({ wallet: 1 }, { unique: true });
    await this.db.collection("wallet_stats").createIndex({ lastTradingTime: -1, _id: -1 });
    await this.createPredictionIndexes();
    await this.db.collection("ml_buys").createIndex({ boughtAt: -1 });
    await this.db.collection("ml_buys").createIndex({ conditionId: 1 });
    await this.db.collection("redeem_history").createIndex({ redeemedAt: -1 });
    await this.db.collection("redeem_history").createIndex({ conditionId: 1 });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }

  async saveMarketResult(result: MarketResult): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection: Collection<MarketResult> = this.db.collection("market_results");
    // Idempotent: avoid duplicate docs when the same market is finalized twice (e.g. timing/restart).
    const existing = await collection.findOne({ conditionId: result.conditionId });
    if (existing) return;
    await collection.insertOne(result);
  }

  async getMarketResults(filter: { eventSlug?: string; conditionId?: string }): Promise<MarketResult[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection: Collection<MarketResult> = this.db.collection("market_results");
    const query: any = {};
    if (filter.eventSlug) query.eventSlug = filter.eventSlug;
    if (filter.conditionId) query.conditionId = filter.conditionId;
    return collection.find(query).sort({ timestamp: -1 }).toArray();
  }

  async getUnresolvedMarketResults(): Promise<MarketResult[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection: Collection<MarketResult> = this.db.collection("market_results");
    return collection.find({ resolvedOutcome: null }).sort({ endTime: 1 }).toArray();
  }

  /**
   * Update market_results with resolution. Only updates docs that are still unresolved
   * so we never overwrite an already-resolved result (e.g. from another process or double run).
   * @returns Number of documents updated (0 if already resolved or no match).
   */
  async updateMarketResultResolution(
    conditionId: string,
    resolvedOutcome: "Up" | "Down",
    profitableWallets: Array<{ wallet: string; buyUpUsd: number; buyDownUsd: number; totalBuyUsd: number; profitUsd: number }>
  ): Promise<number> {
    if (!this.db) throw new Error("MongoDB not connected");
    if (!conditionId || typeof conditionId !== "string") {
      throw new Error("updateMarketResultResolution: conditionId is required");
    }
    const collection: Collection<MarketResult> = this.db.collection("market_results");
    const sorted = [...profitableWallets].sort((a, b) => b.profitUsd - a.profitUsd);
    // Only update docs that are still unresolved – avoids overwriting and double-counting wallet stats
    const result = await collection.updateMany(
      { conditionId, resolvedOutcome: null },
      { $set: { resolvedOutcome, profitableWallets: sorted } }
    );
    return result.modifiedCount;
  }

  async upsertWalletStatsFromResult(result: MarketResult): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection<WalletStatsDoc>("wallet_stats");
    const lastTradingTime = result.endTime ?? result.timestamp;
    const wallets = result.profitableWallets ?? [];
    const ops = wallets.map((w) => {
      const isWin = (w.profitUsd ?? 0) > 0;
      return {
        updateOne: {
          filter: { wallet: w.wallet },
          update: {
            $inc: { winCount: isWin ? 1 : 0, loseCount: isWin ? 0 : 1 },
            $set: { lastTradingTime },
          },
          upsert: true,
        },
      };
    });
    if (ops.length > 0) await collection.bulkWrite(ops);
  }

  async getAllWalletStats(): Promise<WalletStatsDoc[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection<WalletStatsDoc>("wallet_stats");
    return collection.find({}).toArray();
  }

  async getWalletStats(wallet: string): Promise<WalletStatsDoc | null> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection<WalletStatsDoc>("wallet_stats");
    return collection.findOne({ wallet });
  }

  async saveHotWallets(hotWallets: Array<HotWallet>): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection("hot_wallets");
    await collection.deleteMany({});
    if (hotWallets.length > 0) await collection.insertMany(hotWallets);
  }

  async savePrediction(prediction: MarketPrediction): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection("predictions");
    await collection.updateOne(
      { conditionId: prediction.conditionId },
      { $set: prediction },
      { upsert: true }
    );
  }

  async updatePredictionBuyIntent(
    conditionId: string,
    updates: { wouldBuy?: boolean; traded?: boolean }
  ): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const set: Record<string, boolean> = {};
    if (updates.wouldBuy !== undefined) set.wouldBuy = updates.wouldBuy;
    if (updates.traded !== undefined) set.traded = updates.traded;
    if (Object.keys(set).length === 0) return;
    await this.db.collection("predictions").updateOne(
      { conditionId },
      { $set: set }
    );
  }

  async updatePredictionAccuracy(conditionId: string, actualOutcome: "Up" | "Down"): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection("predictions");
    const prediction = await collection.findOne({ conditionId });
    if (prediction) {
      const isCorrect = prediction.predictedOutcome === actualOutcome;
      await collection.updateOne(
        { conditionId },
        {
          $set: {
            actualOutcome,
            isCorrect,
            accuracyUpdatedAt: Math.floor(Date.now() / 1000),
          },
        }
      );
    } else {
      // No prediction row exists (origin bot never predicted this market). Upsert minimal doc so actualOutcome is stored (e.g. for training/analytics).
      await collection.updateOne(
        { conditionId },
        {
          $set: {
            conditionId,
            actualOutcome,
            isCorrect: null,
            accuracyUpdatedAt: Math.floor(Date.now() / 1000),
          },
        },
        { upsert: true }
      );
    }
  }

  async getPredictions(filter?: { conditionId?: string; isCorrect?: boolean }, limit?: number): Promise<MarketPrediction[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection<MarketPrediction>("predictions");
    const query: any = {};
    if (filter?.conditionId) query.conditionId = filter.conditionId;
    if (filter?.isCorrect !== undefined) query.isCorrect = filter.isCorrect;
    let cursor = collection.find(query).sort({ predictedAt: -1 });
    if (limit != null && limit > 0) cursor = cursor.limit(limit);
    return cursor.toArray();
  }

  /** Predictions with actualOutcome and accuracyUpdatedAt null (for backfill scripts). */
  async getPredictionsWithNullActualOutcome(limit = 500): Promise<MarketPrediction[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const collection = this.db.collection<MarketPrediction>("predictions");
    return collection
      .find({ actualOutcome: null, accuracyUpdatedAt: null })
      .sort({ predictedAt: -1 })
      .limit(limit)
      .toArray();
  }

  async createPredictionIndexes(): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    await this.db.collection("hot_wallets").createIndex({ wallet: 1 }, { unique: true });
    await this.db.collection("hot_wallets").createIndex({ winRate: -1 });
    await this.db.collection("predictions").createIndex({ conditionId: 1 }, { unique: true });
    await this.db.collection("predictions").createIndex({ predictedAt: -1 });
    await this.db.collection("predictions").createIndex({ isCorrect: 1 });
  }

  async saveMlBuy(doc: MlBuyDoc): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    await this.db.collection<MlBuyDoc>("ml_buys").insertOne(doc);
  }

  async getMlBuys(filter?: { conditionId?: string }, limit = 100): Promise<MlBuyDoc[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const query: Record<string, unknown> = {};
    if (filter?.conditionId) query.conditionId = filter.conditionId;
    return this.db
      .collection<MlBuyDoc>("ml_buys")
      .find(query)
      .sort({ boughtAt: -1 })
      .limit(limit)
      .toArray();
  }

  async saveRedeemRecord(doc: RedeemRecordDoc): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    await this.db.collection<RedeemRecordDoc>("redeem_history").insertOne(doc);
  }

  async getRedeemHistory(filter?: { conditionId?: string }, limit = 100): Promise<RedeemRecordDoc[]> {
    if (!this.db) throw new Error("MongoDB not connected");
    const query: Record<string, unknown> = {};
    if (filter?.conditionId) query.conditionId = filter.conditionId;
    return this.db
      .collection<RedeemRecordDoc>("redeem_history")
      .find(query)
      .sort({ redeemedAt: -1 })
      .limit(limit)
      .toArray();
  }

  async getEventSlugByConditionId(conditionId: string): Promise<string | null> {
    if (!this.db) throw new Error("MongoDB not connected");
    const doc = await this.db.collection<MarketResult>("market_results").findOne({ conditionId });
    return doc?.eventSlug ?? null;
  }
}
