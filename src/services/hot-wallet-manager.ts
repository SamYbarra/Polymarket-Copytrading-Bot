/**
 * Hot Wallet Manager: Identifies and manages hot wallets (high win rate + recent activity)
 * Uses config-driven recent window (e.g. 60 × 5m markets for BTC 5m).
 */

import { MongoDBClient } from "../clients/mongodb";
import { marketWindowSeconds, defaultHotWalletRecentMarkets } from "../config/market";
import type { HotWallet } from "../types";

const ts = () => new Date().toISOString();

const MIN_WIN_RATE = parseFloat(process.env.MIN_HOT_WALLET_WIN_RATE || "70");
const MIN_RECENT_TRADES = parseInt(process.env.MIN_HOT_WALLET_RECENT_TRADES || "10", 10);
const RECENT_MARKETS_WINDOW = defaultHotWalletRecentMarkets();

export class HotWalletManager {
  private mongodb: MongoDBClient;
  private hotWallets: Map<string, HotWallet> = new Map();
  private lastUpdateTime = 0;
  private updateIntervalMs = 5 * 60 * 1000;

  constructor(mongodb: MongoDBClient) {
    this.mongodb = mongodb;
  }

  async updateHotWallets(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateIntervalMs && this.hotWallets.size > 0) {
      return;
    }

    try {
      const allStats = await this.mongodb.getAllWalletStats();
      const hotWallets: HotWallet[] = [];
      const windowSec = marketWindowSeconds();
      const recentThreshold = Math.floor(Date.now() / 1000) - RECENT_MARKETS_WINDOW * windowSec;

      for (const stat of allStats) {
        const totalTrades = stat.winCount + stat.loseCount;
        if (totalTrades === 0) continue;

        const winRate = (stat.winCount / totalTrades) * 100;
        if (winRate < MIN_WIN_RATE) continue;

        if (stat.lastTradingTime < recentThreshold) continue;

        if (totalTrades < MIN_RECENT_TRADES) continue;

        hotWallets.push({
          wallet: stat.wallet,
          winRate,
          winCount: stat.winCount,
          loseCount: stat.loseCount,
          totalTrades,
          recentTradingCount: totalTrades,
          avgProfitPerTrade: winRate > 50 ? (winRate - 50) / 50 : 0,
          lastTradingTime: stat.lastTradingTime,
          detectedAt: Math.floor(Date.now() / 1000),
        });
      }

      hotWallets.sort((a, b) => {
        if (Math.abs(a.winRate - b.winRate) > 0.1) return b.winRate - a.winRate;
        return b.totalTrades - a.totalTrades;
      });

      this.hotWallets.clear();
      for (const h of hotWallets) {
        this.hotWallets.set(h.wallet, h);
      }
      this.lastUpdateTime = now;

      if (hotWallets.length > 0) {
        console.log(`${ts()} ℹ Hot wallets: ${hotWallets.length}`);
      } else {
        console.log(`${ts()} ℹ Hot wallets: 0 (wallet_stats=${allStats.length}; run src/scripts/check-hot-wallets.ts to inspect)`);
      }
    } catch (err) {
      console.error(`${ts()} ✗ Hot wallet update failed`);
      if (err !== undefined) console.error(err);
    }
  }

  getHotWallets(): HotWallet[] {
    return Array.from(this.hotWallets.values());
  }

  getHotWallet(wallet: string): HotWallet | undefined {
    return this.hotWallets.get(wallet);
  }
}
