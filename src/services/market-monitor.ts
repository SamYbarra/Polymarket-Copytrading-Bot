/**
 * Market monitor: track current BTC 5m market, run predictions, buy, and profit-lock exits.
 */

import { PolymarketClient } from "../clients/polymarket";
import { RedisClient } from "../clients/redis";
import { MongoDBClient } from "../clients/mongodb";
import { getBtcPriceUsd } from "../clients/btc-price";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};
import {
  marketWindowSeconds,
  getCurrentWindowTs,
  defaultPredictionTimeMinMinutes,
  defaultPredictionTimeMaxMinutes,
  predictionMinElapsedSeconds,
  predictionRetryIntervalSeconds,
  positionsSyncIntervalSeconds,
} from "../config/market";
import { tradingEnv } from "../config/env";
import { buyWinToken } from "./trading-service";
import { sellWinToken } from "./sell-service";
import { FeatureExtractor } from "./feature-extractor";
import { PredictionService } from "./prediction-service";
import { HotWalletManager } from "./hot-wallet-manager";
import type { RealtimePriceService } from "./realtime-price-service";
import type { MarketInfo, MarketPrediction, MarketResult } from "../types";
import { getHoldings } from "../utils/holdings";
import {
  DEFAULT_PROFIT_LOCK_PARAMS,
  evaluateProfitLock,
  updateHighWaterMark,
  type ProfitLockPositionState,
  type VolRegime,
  type OrderBookSnapshot,
} from "./profit-lock";

const PREDICTION_TIME_MIN = defaultPredictionTimeMinMinutes();
const PREDICTION_TIME_MAX = defaultPredictionTimeMaxMinutes();
const PREDICTION_MIN_ELAPSED_SECONDS = predictionMinElapsedSeconds();
const PREDICTION_RETRY_INTERVAL_SECONDS = predictionRetryIntervalSeconds();
const POSITIONS_SYNC_INTERVAL_SECONDS = positionsSyncIntervalSeconds();
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "10");
const MIN_VOLUME_FOR_PREDICTION = parseFloat(process.env.MIN_VOLUME_FOR_PREDICTION || "0");
const MIN_TRADES_FOR_PREDICTION = parseInt(process.env.MIN_TRADES_FOR_PREDICTION || "0", 10);
const ENABLE_PROFIT_LOCK = process.env.ENABLE_PROFIT_LOCK !== "false";

export class MarketMonitor {
  private polymarket: PolymarketClient;
  private redis: RedisClient;
  private mongodb: MongoDBClient;
  private realtimePriceService: RealtimePriceService;
  private hotWalletManager: HotWalletManager;
  private featureExtractor: FeatureExtractor;
  private predictionService: PredictionService;

  private trackedMarkets = new Map<string, MarketInfo>();
  private predictedMarkets = new Set<string>();
  private tradedMarkets = new Set<string>();
  private lastPredictionTimeByMarket = new Map<string, number>();
  private lastPredictionByMarket = new Map<string, MarketPrediction>();
  private lastProcessedTimestamps = new Map<string, number>();
  private lastPositionsSyncTime = new Map<string, number>();
  private profitLockPositions = new Map<string, ProfitLockPositionState>();

  constructor(
    polymarket: PolymarketClient,
    redis: RedisClient,
    mongodb: MongoDBClient,
    realtimePriceService: RealtimePriceService
  ) {
    this.polymarket = polymarket;
    this.redis = redis;
    this.mongodb = mongodb;
    this.realtimePriceService = realtimePriceService;
    this.hotWalletManager = new HotWalletManager(mongodb);
    this.featureExtractor = new FeatureExtractor(
      polymarket,
      redis,
      this.hotWalletManager,
      realtimePriceService
    );
    this.predictionService = new PredictionService(mongodb);
  }

  async processCycle(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const windowTs = getCurrentWindowTs();
    const current = await this.polymarket.getCurrentBtc5MarketWithTradingState();
    if (!current) return;

    const { marketInfo, event } = current;
    const cid = marketInfo.conditionId;

    if (!this.trackedMarkets.has(cid)) {
      this.trackedMarkets.set(cid, marketInfo);
      const btcOpen = await getBtcPriceUsd();
      if (btcOpen != null) await this.redis.setBtcOpen(cid, btcOpen);
      const tokenIds = await this.polymarket.getMarketTokenIds(marketInfo.eventSlug, cid);
      if (tokenIds.upTokenId && tokenIds.downTokenId) {
        this.realtimePriceService.subscribe(cid, tokenIds.upTokenId, tokenIds.downTokenId);
      }
      const wallets = await this.polymarket.fetchMarketPositions(cid);
      await this.redis.setMarketWallets(cid, wallets);
      this.lastPositionsSyncTime.set(cid, now);
    } else if (
      (this.lastPositionsSyncTime.get(cid) ?? 0) + POSITIONS_SYNC_INTERVAL_SECONDS <= now
    ) {
      const wallets = await this.polymarket.fetchMarketPositions(cid);
      await this.redis.setMarketWallets(cid, wallets);
      this.lastPositionsSyncTime.set(cid, now);
    }

    const toFinalizeThisLoop: string[] = [];
    const info = this.trackedMarkets.get(cid)!;
    const elapsedSec = now - info.startTime;
    const minutesElapsed = Math.floor(elapsedSec / 60);
    const pastMinElapsed = elapsedSec >= PREDICTION_MIN_ELAPSED_SECONDS;
    const inPredictionWindow = pastMinElapsed && minutesElapsed <= PREDICTION_TIME_MAX;
    const canFinalize = now >= info.endTime;

    if (canFinalize) {
      toFinalizeThisLoop.push(cid);
    } else {
      let readinessOk = true;
      if (MIN_VOLUME_FOR_PREDICTION > 0 || MIN_TRADES_FOR_PREDICTION > 0) {
        const wallets = await this.redis.getMarketWallets(cid);
        const totalVolume = wallets.reduce((s, w) => s + w.totalBuyUsd, 0);
        const tradeCount = wallets.length;
        if (totalVolume < MIN_VOLUME_FOR_PREDICTION || tradeCount < MIN_TRADES_FOR_PREDICTION) {
          readinessOk = false;
        }
      }

      const notYetPredicted = !this.predictedMarkets.has(cid);
      const shouldPredict = inPredictionWindow && notYetPredicted && readinessOk;
      const shouldRetryPredict =
        inPredictionWindow &&
        this.predictedMarkets.has(cid) &&
        !this.tradedMarkets.has(cid) &&
        (now - (this.lastPredictionTimeByMarket.get(cid) ?? 0) >= PREDICTION_RETRY_INTERVAL_SECONDS);

      if (shouldPredict) {
        const result = await this.makePrediction(cid, info, minutesElapsed);
        this.predictedMarkets.add(cid);
        if (result) {
          this.lastPredictionTimeByMarket.set(cid, now);
          this.lastPredictionByMarket.set(cid, result.prediction);
          if (result.traded) this.tradedMarkets.add(cid);
        }
      } else if (shouldRetryPredict) {
        const result = await this.makePrediction(cid, info, minutesElapsed);
        if (result) {
          this.lastPredictionTimeByMarket.set(cid, now);
          this.lastPredictionByMarket.set(cid, result.prediction);
          if (result.traded) this.tradedMarkets.add(cid);
        }
      }

      if (ENABLE_PROFIT_LOCK) {
        await this.runProfitLock(cid, info, now);
      }
    }

    for (const id of toFinalizeThisLoop) {
      const inf = this.trackedMarkets.get(id);
      if (inf) {
        if (!this.tradedMarkets.has(id)) {
          const lastPred = this.lastPredictionByMarket.get(id);
          if (lastPred) {
            lastPred.traded = false;
            lastPred.wouldBuy = lastPred.wouldBuy ?? false;
            await this.mongodb.savePrediction(lastPred);
          }
        }
        this.realtimePriceService.unsubscribe(id);
        await this.finalizeMarket(id, inf);
        this.trackedMarkets.delete(id);
        this.lastProcessedTimestamps.delete(id);
        this.lastPositionsSyncTime.delete(id);
        this.predictedMarkets.delete(id);
        this.tradedMarkets.delete(id);
        this.lastPredictionTimeByMarket.delete(id);
        this.lastPredictionByMarket.delete(id);
        this.profitLockPositions.delete(id);
      }
    }
  }

  private async runProfitLock(conditionId: string, marketInfo: MarketInfo, nowSec: number): Promise<void> {
    const position = this.profitLockPositions.get(conditionId);
    if (!position || position.remainingShares <= 0) return;

    const tokenIds = await this.polymarket.getMarketTokenIds(marketInfo.eventSlug, conditionId);
    const tokenId = position.predictedOutcome === "Up" ? tokenIds.upTokenId : tokenIds.downTokenId;
    if (!tokenId) return;

    const ob = await this.realtimePriceService.getOrderBook(tokenId);
    if (!ob || !ob.bids.length || !ob.asks.length) return;

    const bestBid = parseFloat(ob.bids[0].price);
    const bestAsk = parseFloat(ob.asks[0].price);
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const depthOurSide = ob.bids.reduce((s, l) => s + parseFloat(l.size), 0);

    updateHighWaterMark(position, mid);

    const book: OrderBookSnapshot = {
      bestBid,
      bestAsk,
      spread,
      depthOurSide,
    };

    const volRegime: VolRegime = "normal";
    const action = evaluateProfitLock(
      {
        position,
        marketStartTimeSec: marketInfo.startTime,
        marketEndTimeSec: marketInfo.endTime,
        book,
        volRegime,
        mid,
        nowSec,
      },
      DEFAULT_PROFIT_LOCK_PARAMS
    );

    if (action.type === "hold") return;

    const originalShares = position.shares;
    let sellShares = 0;
    if (action.type === "sell_partial_t1" && action.sizeRatio != null) {
      sellShares = Math.max(0, originalShares * action.sizeRatio);
      position.t1Hit = true;
    } else if (action.type === "sell_partial_t2" && action.sizeRatio != null) {
      sellShares = Math.max(0, originalShares * action.sizeRatio);
      position.t2Hit = true;
    } else if (action.type === "sell_partial_t3" || action.type === "flatten_remaining" || action.type === "sell_trail") {
      sellShares = position.remainingShares;
    } else if (action.type === "exit_collapse" && action.sizeRatio != null) {
      sellShares = Math.max(0, position.remainingShares * action.sizeRatio);
    }

    if (sellShares <= 0) return;

    const toSell = Math.min(sellShares, position.remainingShares, getHoldings(conditionId, tokenId));
    if (toSell <= 0) return;

    const ok = await sellWinToken(tokenId, toSell, conditionId, this.realtimePriceService, {
      actionType: action.type,
      reason: action.reason,
    });
    if (ok) {
      position.remainingShares -= toSell;
      console.log(`${ts()} 📊 Profit lock ${action.type} ${shortId(conditionId)}: sold ${toSell.toFixed(2)} (${action.reason ?? ""})`);
    }
  }

  private async makePrediction(
    conditionId: string,
    marketInfo: MarketInfo,
    minutesElapsed: number
  ): Promise<{ prediction: MarketPrediction; traded: boolean } | null> {
    try {
      await this.hotWalletManager.updateHotWallets();
      const features = await this.featureExtractor.extractFeatures(conditionId, marketInfo);
      if (!features) {
        console.log(`${ts()} ⏭ No features for ${shortId(conditionId)} (no wallets)`);
        return null;
      }

      const payload = JSON.stringify({
        features,
        timestamp: Date.now(),
        conditionId,
      });
      await this.redis.setRealtimeFeatures(conditionId, payload);
      console.log(`${ts()} ℹ Market features fetched and saved to Redis cid=${shortId(conditionId)}`);

      const prediction = await this.predictionService.predictOnly(features);
      prediction.wouldBuy = prediction.wouldBuy ?? false;
      prediction.traded = prediction.traded ?? false;
      await this.mongodb.savePrediction(prediction);

      if (prediction.fromEnsemble && prediction.confidence < tradingEnv.ENSEMBLE_MIN_CONFIDENCE) {
        console.log(
          `${ts()} ⏭ ML buy: ensemble confidence ${(prediction.confidence * 100).toFixed(1)}% < ENSEMBLE_MIN_CONFIDENCE ${(tradingEnv.ENSEMBLE_MIN_CONFIDENCE * 100).toFixed(0)}%`
        );
        return { prediction, traded: false };
      }

      const atEarlyPredictionTime = minutesElapsed <= PREDICTION_TIME_MIN;
      const minConfidence = atEarlyPredictionTime
        ? tradingEnv.ML_BUY_MIN_CONFIDENCE_AT_EARLY_TIME
        : tradingEnv.ML_BUY_MIN_CONFIDENCE;
      if (prediction.confidence < minConfidence) {
        console.log(
          `${ts()} ⏭ ML buy: confidence ${(prediction.confidence * 100).toFixed(1)}% < min ${(minConfidence * 100).toFixed(0)}%`
        );
        return { prediction, traded: false };
      }

      const btcOpen = await this.redis.getBtcOpen(conditionId);
      const currentBtc = await getBtcPriceUsd();
      if (btcOpen != null && currentBtc != null) {
        const delta = Math.abs(currentBtc - btcOpen);
        if (delta <= tradingEnv.SAFE_DELTA) {
          console.log(`${ts()} ⏭ ML buy: delta ${delta.toFixed(2)} ≤ SAFE_DELTA ${tradingEnv.SAFE_DELTA}`);
          return { prediction, traded: false };
        }
      } else {
        console.log(`${ts()} ⏭ ML buy: no btc_open or current BTC for ${shortId(conditionId)}`);
        return { prediction, traded: false };
      }

      const tokenIds = await this.polymarket.getMarketTokenIds(marketInfo.eventSlug, conditionId);
      const tokenId = prediction.predictedOutcome === "Up" ? tokenIds.upTokenId : tokenIds.downTokenId;
      let executionPrice: number | null = null;
      if (tokenId) {
        const book = await this.realtimePriceService.getOrderBook(tokenId);
        const bestAsk = book?.asks?.length ? parseFloat(book.asks[0].price) : null;
        if (bestAsk != null) executionPrice = bestAsk;
      }
      if (executionPrice == null) {
        console.log(`${ts()} ⏭ ML buy: no execution price for ${shortId(conditionId)}`);
        return { prediction, traded: false };
      }
      if (executionPrice <= tradingEnv.BUY_PRICE_MIN || executionPrice >= tradingEnv.BUY_PRICE_MAX) {
        console.log(
          `${ts()} ⏭ ML buy: price ${executionPrice.toFixed(3)} outside (${tradingEnv.BUY_PRICE_MIN}, ${tradingEnv.BUY_PRICE_MAX}) — skip`
        );
        return { prediction, traded: false };
      }

      if (prediction.fromEnsemble && !tradingEnv.ENSEMBLE_BUY_ALLOWED) {
        console.log(`${ts()} ⏭ ML buy: prediction from ensemble; ENSEMBLE_BUY_ALLOWED is false`);
        return { prediction, traded: false };
      }

      prediction.wouldBuy = true;
      let bought = false;
      try {
        bought = await buyWinToken(
          this.polymarket,
          conditionId,
          marketInfo,
          prediction.predictedOutcome,
          prediction.confidence,
          this.mongodb,
          this.realtimePriceService,
          btcOpen != null && currentBtc != null
            ? { btcOpen, currentBtc, delta: Math.abs(currentBtc - btcOpen) }
            : undefined
        );
      } catch (buyErr) {
        console.error(`${ts()} ✗ ML buy failed for ${shortId(conditionId)}`);
        if (buyErr !== undefined) console.error(buyErr);
      }

      if (bought && executionPrice != null && ENABLE_PROFIT_LOCK) {
        const shares = tradingEnv.BUY_SHARES;
        const state: ProfitLockPositionState = {
          conditionId,
          predictedOutcome: prediction.predictedOutcome,
          entryPrice: executionPrice,
          confidence: prediction.confidence,
          shares,
          entryTimeSec: Math.floor(Date.now() / 1000),
          t1Hit: false,
          t2Hit: false,
          highWaterMark: executionPrice,
          bayesianUpdated: false,
          remainingShares: shares,
        };
        this.profitLockPositions.set(conditionId, state);
      }

      prediction.traded = bought;
      if (bought) await this.mongodb.savePrediction(prediction);
      return { prediction, traded: bought };
    } catch (err) {
      console.error(`${ts()} ✗ Prediction failed for ${shortId(conditionId)}`);
      if (err !== undefined) console.error(err);
      return null;
    }
  }

  private async finalizeMarket(conditionId: string, marketInfo: MarketInfo): Promise<void> {
    console.log(`${ts()} 🏁 Finalizing ${shortId(conditionId)} (saving history, resolution pending)`);

    const rawWallets = await this.redis.getMarketWallets(conditionId);
    const wallets = rawWallets.filter((w) => w.totalBuyUsd >= MIN_BUY_USD);
    if (wallets.length === 0) {
      console.log(`${ts()} 📊 No wallets for ${shortId(conditionId)}`);
      await this.redis.deleteMarket(conditionId);
      return;
    }

    const allWallets = wallets
      .map((w) => ({
        wallet: w.wallet,
        buyUpUsd: w.buyUpUsd,
        buyDownUsd: w.buyDownUsd,
        totalBuyUsd: w.totalBuyUsd,
        profitUsd: 0,
      }))
      .sort((a, b) => b.totalBuyUsd - a.totalBuyUsd);

    const result: MarketResult = {
      conditionId,
      eventSlug: marketInfo.eventSlug,
      startTime: marketInfo.startTime,
      endTime: marketInfo.endTime,
      resolvedOutcome: null,
      profitableWallets: allWallets,
      timestamp: Math.floor(Date.now() / 1000),
    };

    await this.mongodb.saveMarketResult(result);
    await this.redis.deleteMarket(conditionId);
    console.log(`${ts()} 🏁 ${shortId(conditionId)} saved (${allWallets.length} wallets, resolution pending)`);
  }
}
