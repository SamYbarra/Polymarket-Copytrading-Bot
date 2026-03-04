/**
 * Resolver service: polls for unresolved markets, fetches resolution from Gamma API, updates DB.
 * After any market is resolved, triggers automatic ML model training (if ENABLE_ML_AUTO_TRAIN is not false).
 */

import "dotenv/config";
import { PolymarketClient } from "./clients/polymarket";
import { MongoDBClient } from "./clients/mongodb";
import { triggerAutoTrain } from "./services/ml-auto-train";
import type { MarketResult } from "./types";

const POLL_INTERVAL_MS = 60 * 1000;
const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

/** Returns number of markets resolved this cycle. */
async function runCycle(polymarket: PolymarketClient, mongodb: MongoDBClient): Promise<number> {
  const unresolved = await mongodb.getUnresolvedMarketResults();
  console.log("unresolved", unresolved.length);
  if (unresolved.length === 0) return 0;

  // Dedupe by conditionId so we only process each market once (avoids double-counting wallet stats when duplicates exist)
  const byConditionId = new Map<string, (typeof unresolved)[0]>();
  for (const doc of unresolved) {
    const cid = doc.conditionId;
    if (!cid || typeof cid !== "string") {
      console.error(`${ts()} ✗ Resolver: skipping doc with missing conditionId`);
      continue;
    }
    if (!byConditionId.has(cid)) byConditionId.set(cid, doc);
  }

  let resolvedCount = 0;

  for (const doc of byConditionId.values()) {
    const { conditionId, eventSlug, profitableWallets } = doc;
    const resolvedOutcome = await polymarket.getResolutionOutcome(eventSlug, conditionId);

    if (resolvedOutcome !== "Up" && resolvedOutcome !== "Down") {
      continue;
    }

    const wallets = profitableWallets ?? [];
    const withProfits = wallets.map((w) => {
      const profitUsd =
        resolvedOutcome === "Up"
          ? w.buyUpUsd - w.buyDownUsd
          : w.buyDownUsd - w.buyUpUsd;
      return {
        wallet: w.wallet,
        buyUpUsd: w.buyUpUsd,
        buyDownUsd: w.buyDownUsd,
        totalBuyUsd: w.totalBuyUsd,
        profitUsd,
      };
    });

    const modifiedCount = await mongodb.updateMarketResultResolution(conditionId, resolvedOutcome, withProfits);

    // Only update wallet_stats and prediction when we actually wrote to market_results (avoids double-count if already resolved elsewhere)
    if (modifiedCount === 0) continue;

    const result: MarketResult = {
      conditionId,
      eventSlug: doc.eventSlug,
      startTime: doc.startTime,
      endTime: doc.endTime,
      resolvedOutcome,
      profitableWallets: withProfits,
      timestamp: doc.timestamp,
    };
    await mongodb.upsertWalletStatsFromResult(result);

    const { PredictionService } = await import("./services/prediction-service");
    const predictionService = new PredictionService(mongodb);
    await predictionService.updatePredictionAccuracy(conditionId, resolvedOutcome);

    const profitableCount = withProfits.filter((w) => w.profitUsd > 0).length;
    console.log(`${ts()} 🏁 ${shortId(conditionId)} → ${resolvedOutcome}, ${withProfits.length} wallets, ${profitableCount} profitable`);
    resolvedCount++;
  }

  if (resolvedCount > 0) {
    triggerAutoTrain();
  }
  return resolvedCount;
}

async function main(): Promise<void> {
  console.log(`${ts()} ▶ Resolver (poll ${POLL_INTERVAL_MS / 1000}s)`);

  const polymarket = new PolymarketClient();
  const mongodb = new MongoDBClient();

  await mongodb.connect();
  console.log(`${ts()} 🔗 MongoDB`);

  await runCycle(polymarket, mongodb);
  setInterval(async () => {
    try {
      await runCycle(polymarket, mongodb);
    } catch (err) {
      console.error(`${ts()} ✗ Resolver cycle`);
      if (err !== undefined) console.error(err);
    }
  }, POLL_INTERVAL_MS);

  console.log(`${ts()} ✔ Resolver running`);

  process.on("SIGINT", async () => {
    console.log(`${ts()} ■ Shutting down resolver…`);
    await mongodb.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${ts()} ✗ Fatal error`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
