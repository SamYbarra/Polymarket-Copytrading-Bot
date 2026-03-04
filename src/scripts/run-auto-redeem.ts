/**
 * Standalone process: run only the auto-redeem service (ML-bought positions from token-holding.json).
 * Use this when you want redeem to run in a separate process from the main trading bot.
 *
 * Usage:
 *   npm run auto-redeem
 *
 * Requires .env: ENABLE_AUTO_REDEEM=true, PRIVATE_KEY, PROXY_WALLET_ADDRESS.
 * Optional: MONGODB_URI, MONGODB_DB for saving redeem history.
 */

import "dotenv/config";
import { MongoDBClient } from "../clients/mongodb";
import { startAutoRedeemService } from "../services/auto-redeem-service";

const ts = () => new Date().toISOString();

async function main(): Promise<void> {
  console.log(`${ts()} ▶ Starting auto-redeem (standalone)…`);

  let mongodb: MongoDBClient | null = null;
  const uri = (process.env.MONGODB_URI ?? "").trim();
  if (uri) {
    const client = new MongoDBClient();
    try {
      await client.connect();
      console.log(`${ts()} 🔗 MongoDB`);
      mongodb = client;
    } catch (err) {
      console.error(`${ts()} ✗ MongoDB connect failed, continuing without redeem history`);
      if (err !== undefined) console.error(err);
    }
  }

  startAutoRedeemService(mongodb);

  process.on("SIGINT", async () => {
    console.log(`${ts()} ■ Shutting down auto-redeem…`);
    if (mongodb) await mongodb.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${ts()} ✗ Fatal error`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
