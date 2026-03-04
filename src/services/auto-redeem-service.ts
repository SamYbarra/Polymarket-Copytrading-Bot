/**
 * Auto-redeem service for ML-bought positions.
 * Runs periodically, checks token-holding.json, redeems resolved markets.
 * Saves redeem history to MongoDB when mongodb is provided.
 */

import { redeemMarket, isMarketResolved } from "../utils/redeem";
import { getAllHoldings, clearMarketHoldings } from "../utils/holdings";
import { tradingEnv } from "../config/env";
import type { MongoDBClient } from "../clients/mongodb";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

const REDEEM_INTERVAL_MS = 160 * 1000; // 160 seconds (same as polymarket-copytrading-bot)

let totalChecks = 0;
let totalRedeemed = 0;
let totalFailed = 0;
let mongodbInstance: MongoDBClient | null = null;

async function checkAndRedeemPositions(): Promise<void> {
  totalChecks++;
  console.log(`${ts()} 💸 Check #${totalChecks}`);

  const holdings = getAllHoldings();
  const marketIds = Object.keys(holdings);

  if (marketIds.length === 0) {
    return;
  }

  for (const conditionId of marketIds) {
    const tokens = holdings[conditionId];
    const totalAmount = Object.values(tokens).reduce((sum, amt) => sum + amt, 0);

    try {
      const { isResolved, winningIndexSets } = await isMarketResolved(conditionId);

      if (!isResolved) continue;

      console.log(`${ts()} 🏁 ${shortId(conditionId)} resolved, winning: ${winningIndexSets?.join(", ")}`);

      try {
        await redeemMarket(conditionId);
        if (mongodbInstance && totalAmount > 0) {
          const eventSlug = await mongodbInstance.getEventSlugByConditionId(conditionId);
          await mongodbInstance.saveRedeemRecord({
            conditionId,
            eventSlug: eventSlug ?? null,
            redeemedAt: Math.floor(Date.now() / 1000),
            tokensRedeemed: totalAmount,
            payoutUsd: totalAmount,
          });
        }
        clearMarketHoldings(conditionId);
        totalRedeemed++;
        console.log(`${ts()} 💸 Redeemed ${shortId(conditionId)}`);
      } catch (redeemError) {
        const errorMsg = redeemError instanceof Error ? redeemError.message : String(redeemError);

        if (
          errorMsg.includes("don't hold any winning tokens") ||
          errorMsg.includes("You don't have any tokens")
        ) {
          clearMarketHoldings(conditionId);
          console.log(`${ts()} ℹ Lost position, cleared ${shortId(conditionId)}`);
        } else {
          totalFailed++;
          console.error(`${ts()} ✗ Redemption failed: ${errorMsg}`);
        }
      }
    } catch (error) {
      totalFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`${ts()} ✗ ${errorMsg}`);
    }
  }
}

export function startAutoRedeemService(mongodb?: MongoDBClient | null): void {
  mongodbInstance = mongodb ?? null;
  if (!tradingEnv.ENABLE_AUTO_REDEEM) return;
  if (!tradingEnv.PRIVATE_KEY || !tradingEnv.PROXY_WALLET_ADDRESS) {
    console.log(`${ts()} ⏭ Auto-redeem: trading credentials not set`);
    return;
  }

  console.log(`${ts()} ✔ Auto-redeem started (${REDEEM_INTERVAL_MS / 1000}s)`);

  checkAndRedeemPositions();

  setInterval(() => {
    checkAndRedeemPositions().catch((err) => {
      console.error(`${ts()} ✗ Auto-redeem error`);
      if (err !== undefined) console.error(err);
    });
  }, REDEEM_INTERVAL_MS);
}
