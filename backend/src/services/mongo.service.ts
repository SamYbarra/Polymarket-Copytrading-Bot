import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, Db, Collection } from 'mongodb';

const rawUri = (process.env.MONGODB_URI || 'mongodb+srv://onlybitcoin:kig020829@cluster0.9koasrn.mongodb.net/?appName=Cluster0').trim();
const uri = rawUri;
const dbName = process.env.MONGODB_DB || 'polymarket_btc5';

export interface MarketResultDoc {
  conditionId: string;
  eventSlug?: string;
  [key: string]: unknown;
}
export interface WalletStatsDoc {
  wallet: string;
  winCount: number;
  loseCount: number;
  lastTradingTime: number;
}
export interface PredictionDoc {
  conditionId: string;
  eventSlug?: string;
  predictedOutcome: 'Up' | 'Down';
  confidence: number;
  predictedAt: number;
  actualOutcome?: 'Up' | 'Down' | null;
  isCorrect?: boolean | null;
  wouldBuy?: boolean;
  traded?: boolean;
}

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient | null = null;
  private _db: Db | null = null;

  async onModuleInit() {
    this.client = new MongoClient(uri);
    await this.client.connect();
    this._db = this.client.db(dbName);
  }

  async onModuleDestroy() {
    if (this.client) await this.client.close();
  }

  private db(): Db {
    if (!this._db) throw new Error('MongoDB not connected');
    return this._db;
  }

  async getMarketResults(filter: { eventSlug?: string; conditionId?: string }): Promise<MarketResultDoc[]> {
    const col: Collection<MarketResultDoc> = this.db().collection('market_results');
    const query: Record<string, string> = {};
    if (filter.eventSlug) query.eventSlug = filter.eventSlug;
    if (filter.conditionId) query.conditionId = filter.conditionId;
    return col.find(query).sort({ timestamp: -1 }).toArray();
  }

  async getAllWalletStats(): Promise<WalletStatsDoc[]> {
    const col = this.db().collection<WalletStatsDoc>('wallet_stats');
    return col.find({}).toArray();
  }

  async getPredictions(filter?: { conditionId?: string }, limit?: number): Promise<PredictionDoc[]> {
    const col = this.db().collection<PredictionDoc>('predictions');
    const query: Record<string, string> = {};
    if (filter?.conditionId) query.conditionId = filter.conditionId;
    let cursor = col.find(query).sort({ predictedAt: -1 });
    if (limit != null && limit > 0) cursor = cursor.limit(limit);
    return cursor.toArray();
  }
}
