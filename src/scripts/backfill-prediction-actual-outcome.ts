/**
 * Temp script: find predictions where actualOutcome and accuracyUpdatedAt are null,
 * fetch resolution from Polymarket, and update the prediction row.
 * Usage: npx ts-node src/scripts/backfill-prediction-actual-outcome.ts
 *        npx ts-node src/scripts/backfill-prediction-actual-outcome.ts --limit=100
 */

import "dotenv/config";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { PolymarketClient } from "../clients/polymarket";
import { MongoDBClient } from "../clients/mongodb";

const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

const LIMIT = parseInt(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "500", 10);

export async function runBackfillCycle(polymarket: PolymarketClient, mongodb: MongoDBClient, limit = LIMIT): Promise<{ updated: number; skipped: number }> {
  const pending = await mongodb.getPredictionsWithNullActualOutcome(limit);
  if (pending.length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  for (const pred of pending) {
    const { conditionId, eventSlug } = pred;
    let resolvedOutcome = await polymarket.getResolutionOutcome(eventSlug, conditionId);
    if (resolvedOutcome !== "Up" && resolvedOutcome !== "Down") {
      resolvedOutcome = await polymarket.getResolutionOutcomeByConditionId(conditionId);
    }
    if (resolvedOutcome !== "Up" && resolvedOutcome !== "Down") {
      console.log(`  skip ${shortId(conditionId)}: no resolution from API`);
      skipped++;
      continue;
    }
    await mongodb.updatePredictionAccuracy(conditionId, resolvedOutcome);
    console.log(`  updated ${shortId(conditionId)} → ${resolvedOutcome}`);
    updated++;
  }

  return { updated, skipped };
}

async function main(): Promise<void> {
  const polymarket = new PolymarketClient();
  const mongodb = new MongoDBClient();
  await mongodb.connect();

  console.log(`Found predictions with actualOutcome and accuracyUpdatedAt null (limit=${LIMIT}).`);
  const { updated, skipped } = await runBackfillCycle(polymarket, mongodb);
  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
  await mongodb.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
