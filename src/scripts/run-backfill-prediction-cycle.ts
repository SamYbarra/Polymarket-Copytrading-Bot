/**
 * Run backfill-prediction-actual-outcome every 300s.
 * Usage: npm run backfill-prediction-cycle
 */

import "dotenv/config";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { PolymarketClient } from "../clients/polymarket";
import { MongoDBClient } from "../clients/mongodb";
import { runBackfillCycle } from "./backfill-prediction-actual-outcome";

const INTERVAL_MS = 300 * 1000;

async function main(): Promise<void> {
  const polymarket = new PolymarketClient();
  const mongodb = new MongoDBClient();
  await mongodb.connect();

  console.log(`Backfill prediction actual outcome: running every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);

  const run = async (): Promise<void> => {
    try {
      const { updated, skipped } = await runBackfillCycle(polymarket, mongodb);
      if (updated > 0 || skipped > 0) {
        console.log(`[${new Date().toISOString()}] cycle done: updated=${updated}, skipped=${skipped}`);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] backfill cycle error:`, err);
    }
  };

  await run();
  setInterval(run, INTERVAL_MS);

  process.on("SIGINT", async () => {
    await mongodb.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
