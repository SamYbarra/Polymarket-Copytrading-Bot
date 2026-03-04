import { Injectable } from '@nestjs/common';
import { MongoService } from '../services/mongo.service';
import { RedisService } from '../services/redis.service';
import { BtcPriceService } from '../services/btc-price.service';
import { GammaService } from '../services/gamma.service';
import { ClobService, WalletBalanceDto, MyOrderDto } from '../services/clob.service';

@Injectable()
export class TrackerService {
  constructor(
    private readonly mongo: MongoService,
    private readonly redis: RedisService,
    private readonly btcPrice: BtcPriceService,
    private readonly gamma: GammaService,
    private readonly clob: ClobService,
  ) {}

  async getMarketResults(filter?: { eventSlug?: string; conditionId?: string }) {
    return this.mongo.getMarketResults(filter || {});
  }

  async getStatus() {
    const currentMarket = await this.gamma.getCurrentMarket();
    const redisMarkets: { conditionId: string; walletCount: number; totalUsd: number }[] = [];
    if (this.redis.isConnected()) {
      const conditionIds = await this.redis.listActiveMarkets();
      for (const cid of conditionIds) {
        const wallets = await this.redis.getMarketWallets(cid);
        const totalUsd = wallets.reduce((s, w) => s + w.totalBuyUsd, 0);
        redisMarkets.push({ conditionId: cid, walletCount: wallets.length, totalUsd });
      }
    }
    return { currentMarket, redisMarkets, redisConnected: this.redis.isConnected() };
  }

  async getRedisState() {
    if (!this.redis.isConnected()) {
      return { markets: [], redisConnected: false };
    }
    const conditionIds = await this.redis.listActiveMarkets();
    const markets = await Promise.all(
      conditionIds.map(async (cid) => {
        const wallets = await this.redis.getMarketWallets(cid);
        return {
          conditionId: cid,
          wallets: wallets.map((w) => ({
            wallet: w.wallet,
            totalBuyUsd: w.totalBuyUsd,
            buyUpUsd: w.buyUpUsd,
            buyDownUsd: w.buyDownUsd,
            buyUpCount: w.buyUpCount,
            buyDownCount: w.buyDownCount,
          })),
        };
      }),
    );
    return { markets, redisConnected: true };
  }

  async getDashboardStreamPayload(): Promise<{
    state: Awaited<ReturnType<TrackerService['getCurrentMarketState']>>;
    market: Awaited<ReturnType<TrackerService['getCurrentMarket']>>;
    ml: Awaited<ReturnType<TrackerService['getMlCurrent']>>;
    walletBalance: WalletBalanceDto | null;
    myOrders: MyOrderDto[];
  }> {
    const [state, market, ml] = await Promise.all([
      this.getCurrentMarketState(),
      this.getCurrentMarket(),
      this.getMlCurrent(),
    ]);
    const conditionId = state?.currentMarket?.conditionId ?? null;
    const [walletBalance, myOrders] = await Promise.all([
      this.clob.getWalletBalance(),
      conditionId ? this.clob.getOpenOrdersForMarket(conditionId) : Promise.resolve([]),
    ]);
    return { state, market, ml, walletBalance, myOrders };
  }

  async getWalletBalance(): Promise<WalletBalanceDto | null> {
    return this.clob.getWalletBalance();
  }

  async getMyOrders(market: string): Promise<MyOrderDto[]> {
    return market ? this.clob.getOpenOrdersForMarket(market) : [];
  }

  async getCurrentMarketState() {
    const current = await this.gamma.getCurrentMarket();
    if (!current) {
      return {
        currentMarket: null,
        btcOpenPrice: null,
        currentBtcPrice: null,
        upMidPrice: null,
        downMidPrice: null,
        message: 'No current 5m market',
      };
    }
    const now = Math.floor(Date.now() / 1000);
    let btcOpenPrice = this.redis.isConnected()
      ? await this.redis.getBtcOpen(current.conditionId)
      : null;
    if (btcOpenPrice == null) {
      btcOpenPrice = await this.btcPrice.getBtcPriceUsdAtTime(current.startTime);
      if (btcOpenPrice == null && now - current.startTime <= 60) {
        btcOpenPrice = await this.btcPrice.getBtcPriceUsd();
      }
      if (btcOpenPrice != null && this.redis.isConnected()) {
        await this.redis.setBtcOpen(current.conditionId, btcOpenPrice);
      }
    }
    const secondsLeft = Math.max(0, current.endTime - now);
    let currentBtcPrice: number | null = null;
    try {
      currentBtcPrice = await this.btcPrice.getBtcPriceUsd();
    } catch {
      // ignore
    }
    const { upMidPrice, downMidPrice, upTokenId, downTokenId } =
      await this.gamma.getMidpoints(current.eventSlug, current.conditionId);
    return {
      currentMarket: {
        conditionId: current.conditionId,
        eventSlug: current.eventSlug,
        startTime: current.startTime,
        endTime: current.endTime,
        isActive: current.isActive,
        secondsLeft,
        upTokenId,
        downTokenId,
      },
      btcOpenPrice,
      currentBtcPrice,
      upMidPrice,
      downMidPrice,
    };
  }

  async getCurrentMarket() {
    const current = await this.gamma.getCurrentMarket();
    if (!current) {
      return {
        currentMarket: null,
        totalAmount: 0,
        totalWalletCount: 0,
        totalUp: 0,
        totalDown: 0,
        wallets: [],
      };
    }
    const wallets = this.redis.isConnected()
      ? await this.redis.getMarketWallets(current.conditionId)
      : [];
    const totalAmount = wallets.reduce((s, w) => s + w.totalBuyUsd, 0);
    const totalUp = wallets.reduce((s, w) => s + w.buyUpUsd, 0);
    const totalDown = wallets.reduce((s, w) => s + w.buyDownUsd, 0);
    return {
      currentMarket: {
        conditionId: current.conditionId,
        eventSlug: current.eventSlug,
        startTime: current.startTime,
        endTime: current.endTime,
        isActive: current.isActive,
      },
      totalAmount,
      totalWalletCount: wallets.length,
      totalUp,
      totalDown,
      wallets: wallets.map((w) => ({
        wallet: w.wallet,
        up: w.buyUpUsd,
        down: w.buyDownUsd,
        buyTime: w.lastBuyTime ?? null,
      })),
    };
  }

  async getWalletStats() {
    const stats = await this.mongo.getAllWalletStats();
    const wallets = stats.map((s) => {
      const total = s.winCount + s.loseCount;
      const winRate = total > 0 ? (s.winCount / total) * 100 : 0;
      return {
        wallet: s.wallet,
        winCount: s.winCount,
        loseCount: s.loseCount,
        winRate: Math.round(winRate * 100) / 100,
        lastTradingTime: s.lastTradingTime,
      };
    });
    return { count: wallets.length, wallets };
  }

  async getPredictions(includeResolved: boolean, limit = 50) {
    const fetchLimit = includeResolved ? limit : Math.min(limit * 3, 500);
    const predictions = await this.mongo.getPredictions(undefined, fetchLimit);
    const list = includeResolved
      ? predictions
      : predictions.filter((p) => p.actualOutcome == null);
    return list.slice(0, Math.min(limit, 500));
  }

  async getPredictionAccuracy() {
    const predictions = await this.mongo.getPredictions();
    const resolved = predictions.filter((p) => p.isCorrect !== null);
    const total = resolved.length;
    const correct = resolved.filter((p) => p.isCorrect).length;
    const recent50 = resolved.slice(0, 50);
    const recentCorrect = recent50.filter((p) => p.isCorrect).length;
    return {
      overall: {
        total,
        correct,
        incorrect: total - correct,
        accuracy: total > 0 ? Math.round((correct / total) * 10000) / 100 : 0,
      },
      recent50: {
        total: recent50.length,
        correct: recentCorrect,
        incorrect: recent50.length - recentCorrect,
        accuracy:
          recent50.length > 0
            ? Math.round((recentCorrect / recent50.length) * 10000) / 100
            : 0,
      },
    };
  }

  async getMlCurrent() {
    const current = await this.gamma.getCurrentMarket();
    if (!current) {
      return { hasPrediction: false, message: 'No current market' };
    }
    const predictions = await this.mongo.getPredictions({
      conditionId: current.conditionId,
    });
    const prediction = predictions[0] ?? null;
    if (!prediction) {
      return {
        hasPrediction: false,
        currentMarket: {
          conditionId: current.conditionId,
          eventSlug: current.eventSlug,
          startTime: current.startTime,
          endTime: current.endTime,
        },
        message: 'No prediction yet for this market',
      };
    }
    const probUp =
      prediction.predictedOutcome === 'Up'
        ? prediction.confidence
        : 1 - prediction.confidence;
    const probDown = 1 - probUp;
    return {
      hasPrediction: true,
      currentMarket: {
        conditionId: current.conditionId,
        eventSlug: current.eventSlug,
        startTime: current.startTime,
        endTime: current.endTime,
      },
      prediction: {
        predictedOutcome: prediction.predictedOutcome,
        confidence: prediction.confidence,
        probUp: Math.round(probUp * 10000) / 100,
        probDown: Math.round(probDown * 10000) / 100,
        predictedAt: prediction.predictedAt,
        actualOutcome: prediction.actualOutcome ?? null,
        isCorrect: prediction.isCorrect ?? null,
        wouldBuy: prediction.wouldBuy,
        traded: prediction.traded,
      },
    };
  }
}
