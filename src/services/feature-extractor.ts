/**
 * Feature Extractor: Extracts ML features from market state at prediction time (during the configured prediction window, e.g. 2–4 min for 5m markets)
 */

import { PolymarketClient } from "../clients/polymarket";
import { RedisClient } from "../clients/redis";
import { getBtcPriceUsd } from "../clients/btc-price";
import { HotWalletManager } from "./hot-wallet-manager";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};
import { RealtimePriceService } from "./realtime-price-service";
import type { MarketInfo, WalletTradeData, MarketFeatures } from "../types";

const LARGE_TRADE_THRESHOLD = parseFloat(process.env.LARGE_TRADE_THRESHOLD_USD || "100");
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "10");

export class FeatureExtractor {
  private polymarket: PolymarketClient;
  private redis: RedisClient;
  private hotWalletManager: HotWalletManager;
  private realtimePriceService: RealtimePriceService;

  constructor(
    polymarket: PolymarketClient,
    redis: RedisClient,
    hotWalletManager: HotWalletManager,
    realtimePriceService: RealtimePriceService
  ) {
    this.polymarket = polymarket;
    this.redis = redis;
    this.hotWalletManager = hotWalletManager;
    this.realtimePriceService = realtimePriceService;
  }

  async extractFeatures(conditionId: string, marketInfo: MarketInfo): Promise<MarketFeatures | null> {
    const now = Math.floor(Date.now() / 1000);
    const minutesElapsed = Math.floor((now - marketInfo.startTime) / 60);

    const allWallets = await this.redis.getMarketWallets(conditionId);
    const wallets = allWallets.filter((w) => w.totalBuyUsd >= MIN_BUY_USD);
    if (wallets.length === 0) return null;

    const btcOpen = await this.redis.getBtcOpen(conditionId);
    const currentBtc = await getBtcPriceUsd();
    const btcDeltaPctAtPrediction =
      btcOpen != null && currentBtc != null && btcOpen > 0
        ? 100 * (currentBtc - btcOpen) / btcOpen
        : 0;

    const hotWallets = this.hotWalletManager.getHotWallets();
    const hotWalletSet = new Set(hotWallets.map((hw) => hw.wallet.toLowerCase()));

    const hotWalletData: WalletTradeData[] = [];
    for (const w of wallets) {
      if (hotWalletSet.has(w.wallet.toLowerCase())) {
        hotWalletData.push(w);
      }
    }

    let hotWalletUpVolume = 0;
    let hotWalletDownVolume = 0;
    let hotWalletCountUp = 0;
    let hotWalletCountDown = 0;
    let hotWalletWinRateSumUp = 0;
    let hotWalletWinRateSumDown = 0;

    for (const w of hotWalletData) {
      const hw = this.hotWalletManager.getHotWallet(w.wallet);
      if (!hw) continue;

      if (w.buyUpUsd > w.buyDownUsd) {
        hotWalletUpVolume += w.totalBuyUsd;
        hotWalletCountUp++;
        hotWalletWinRateSumUp += hw.winRate;
      } else if (w.buyDownUsd > w.buyUpUsd) {
        hotWalletDownVolume += w.totalBuyUsd;
        hotWalletCountDown++;
        hotWalletWinRateSumDown += hw.winRate;
      }
    }

    const hotWalletTotalVolume = hotWalletUpVolume + hotWalletDownVolume;
    const hotWalletImbalance =
      hotWalletTotalVolume > 0
        ? (hotWalletUpVolume - hotWalletDownVolume) / hotWalletTotalVolume
        : 0;
    const hotWalletAvgWinRateUp =
      hotWalletCountUp > 0 ? hotWalletWinRateSumUp / hotWalletCountUp : 0;
    const hotWalletAvgWinRateDown =
      hotWalletCountDown > 0 ? hotWalletWinRateSumDown / hotWalletCountDown : 0;

    let totalVolumeUp = 0;
    let totalVolumeDown = 0;
    let tradeCountUp = 0;
    let tradeCountDown = 0;
    let largeTradeCountUp = 0;
    let largeTradeCountDown = 0;

    for (const w of wallets) {
      totalVolumeUp += w.buyUpUsd;
      totalVolumeDown += w.buyDownUsd;
      if (w.buyUpUsd > w.buyDownUsd) {
        tradeCountUp++;
        if (w.totalBuyUsd >= LARGE_TRADE_THRESHOLD) largeTradeCountUp++;
      } else if (w.buyDownUsd > w.buyUpUsd) {
        tradeCountDown++;
        if (w.totalBuyUsd >= LARGE_TRADE_THRESHOLD) largeTradeCountDown++;
      }
    }

    const totalVolume = totalVolumeUp + totalVolumeDown;
    const volumeRatio = totalVolume > 0 ? totalVolumeUp / totalVolume : 0.5;

    let orderbookImbalance = 0;
    let spreadRatio = 0;
    let liquidityRatio = 0;

    try {
      const tokenIds = await this.polymarket.getMarketTokenIds(marketInfo.eventSlug, conditionId);
      if (tokenIds.upTokenId && tokenIds.downTokenId) {
        const [upBook, downBook] = await Promise.all([
          this.realtimePriceService.getOrderBook(tokenIds.upTokenId),
          this.realtimePriceService.getOrderBook(tokenIds.downTokenId),
        ]);

        if (upBook && downBook) {
          const upBestAsk = upBook.asks.length > 0 ? parseFloat(upBook.asks[0].price) : 0.5;
          const downBestAsk = downBook.asks.length > 0 ? parseFloat(downBook.asks[0].price) : 0.5;
          const upBestAskSize = upBook.asks.length > 0 ? parseFloat(upBook.asks[0].size) : 0;
          const downBestAskSize = downBook.asks.length > 0 ? parseFloat(downBook.asks[0].size) : 0;

          const totalAskSize = upBestAskSize + downBestAskSize;
          orderbookImbalance =
            totalAskSize > 0 ? (upBestAskSize - downBestAskSize) / totalAskSize : 0;

          const avgPrice = (upBestAsk + downBestAsk) / 2;
          spreadRatio = avgPrice > 0 ? Math.abs(upBestAsk - downBestAsk) / avgPrice : 0;

          const minLiquidity = Math.min(upBestAskSize, downBestAskSize);
          const maxLiquidity = Math.max(upBestAskSize, downBestAskSize);
          liquidityRatio = maxLiquidity > 0 ? minLiquidity / maxLiquidity : 0;
        }
      }
    } catch (err) {
      console.error(`${ts()} ✗ Orderbook fetch failed for ${shortId(conditionId)}`);
      if (err !== undefined) console.error(err);
    }

    return {
      conditionId,
      eventSlug: marketInfo.eventSlug,
      timestamp: now,
      minutesElapsed,
      btcDeltaPctAtPrediction,
      hotWalletUpVolume,
      hotWalletDownVolume,
      hotWalletImbalance,
      hotWalletCountUp,
      hotWalletCountDown,
      hotWalletAvgWinRateUp,
      hotWalletAvgWinRateDown,
      hotWalletTotalVolume,
      orderbookImbalance,
      spreadRatio,
      liquidityRatio,
      totalVolumeUp,
      totalVolumeDown,
      volumeRatio,
      tradeCountUp,
      tradeCountDown,
      largeTradeCountUp,
      largeTradeCountDown,
    };
  }
}
