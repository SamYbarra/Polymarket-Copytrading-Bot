/**
 * Check hot wallet list derived from MongoDB wallet_stats.
 * Hot wallets are NOT stored in a collection; they are computed from wallet_stats
 * (win rate >= MIN_HOT_WALLET_WIN_RATE, recent activity, min trades).
 * Usage: npx ts-node src/scripts/check-hot-wallets.ts
 */

import "dotenv/config";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { MongoDBClient } from "../clients/mongodb";
import { marketWindowSeconds, defaultHotWalletRecentMarkets } from "../config/market";
import type { HotWallet } from "../types";

const MIN_WIN_RATE = parseFloat(process.env.MIN_HOT_WALLET_WIN_RATE || "70");
const MIN_RECENT_TRADES = parseInt(process.env.MIN_HOT_WALLET_RECENT_TRADES || "10", 10);
const RECENT_MARKETS_WINDOW = defaultHotWalletRecentMarkets();

function computeHotWallets(allStats: { wallet: string; winCount: number; loseCount: number; lastTradingTime: number }[]): HotWallet[] {
  const hotWallets: HotWallet[] = [];
  const windowSec = marketWindowSeconds();
  const recentThreshold = Math.floor(Date.now() / 1000) - RECENT_MARKETS_WINDOW * windowSec;

  for (const stat of allStats) {
    const totalTrades = stat.winCount + stat.loseCount;
    if (totalTrades === 0) continue;

    const winRate = (stat.winCount / totalTrades) * 100;
    if (winRate < MIN_WIN_RATE) continue;

    if (stat.lastTradingTime < recentThreshold) continue;

    if (totalTrades < 100) continue;

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

  return hotWallets;
}

async function main(): Promise<void> {
  const mongodb = new MongoDBClient();
  await mongodb.connect();

  const allStats = await mongodb.getAllWalletStats();
  const hotWallets = computeHotWallets(allStats);

  console.log("--- Hot wallet check (from MongoDB wallet_stats) ---");
  console.log(`wallet_stats count: ${allStats.length}`);
  console.log(
    `Criteria: winRate >= ${MIN_WIN_RATE}%, totalTrades >= ${MIN_RECENT_TRADES}, lastTradingTime within ${RECENT_MARKETS_WINDOW} windows (${RECENT_MARKETS_WINDOW * (marketWindowSeconds() / 60)} min)`
  );
  console.log(`Hot wallets qualifying: ${hotWallets.length}`);

  if (hotWallets.length > 0) {
    console.log("\nHot wallet list (wallet, winRate%, winCount, loseCount, totalTrades, lastTradingTime):");
    hotWallets.slice(0, 50).forEach((hw) => {
      const last = hw.lastTradingTime ? new Date(hw.lastTradingTime * 1000).toISOString() : "—";
      console.log(`  ${hw.wallet}  winRate=${hw.winRate.toFixed(1)}%  wins=${hw.winCount}  losses=${hw.loseCount}  total=${hw.totalTrades}  last=${last}`);
    });
    if (hotWallets.length > 50) console.log(`  ... and ${hotWallets.length - 50} more`);
  } else {
    console.log("\nNo hot wallets. Ensure resolver has run on resolved markets so wallet_stats is populated, and that some wallets meet the criteria above.");
  }

  await mongodb.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
