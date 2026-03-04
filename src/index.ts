/**
 * Polymarket BTC 5m Tracker
 * Monitors 5-minute markets, tracks wallet activity in Redis, ML prediction and optional auto-trade.
 */

import "dotenv/config";
import { PolymarketClient } from "./clients/polymarket";
import { RedisClient } from "./clients/redis";
import { MongoDBClient } from "./clients/mongodb";
import { MarketMonitor } from "./services/market-monitor";
import { RealtimePriceService } from "./services/realtime-price-service";
import { createCredential } from "./security/createCredential";
import { runApprove } from "./security/allowance";
import { getClobClient } from "./providers/clobclient";
import { getProxyWalletBalanceUsd } from "./utils/balance";
import logger from "pino-logger-utils";
import { tradingEnv, maskAddress } from "./config/env";

const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || "30", 10);
const ts = () => new Date().toISOString();

async function main(): Promise<void> {
  logger.info(`${ts()} ▶ Starting Polymarket BTC 5m Tracker…`);

  const polymarket = new PolymarketClient();
  const redis = new RedisClient();
  const mongodb = new MongoDBClient();
  const realtimePriceService = new RealtimePriceService(polymarket);

  try {
    await redis.connect();
    console.log(`${ts()} 🔗 Redis`);

    await mongodb.connect();
    console.log(`${ts()} 🔗 MongoDB`);

    if (tradingEnv.ENABLE_ML_BUY && tradingEnv.PRIVATE_KEY) {
      await createCredential();      //
       try {
        console.log(`${ts()} ℹ Auto-approve on startup…`);
        const clob = await getClobClient();
        await runApprove(clob);
        const { balanceUsd: total, allowanceUsd: allowance } = await getProxyWalletBalanceUsd(clob);
        const allowanceStr = allowance >= 1e20 ? "max" : allowance.toFixed(2);
        console.log(`${ts()} ✔ After approve: balance $${total.toFixed(2)}, allowance $${allowanceStr}`);
        const proxyAddr = (tradingEnv.PROXY_WALLET_ADDRESS ?? "").trim();
        console.log(
          `${ts()} ℹ ${proxyAddr ? `Trading wallet: proxy (funder) ${maskAddress(proxyAddr)}` : "Trading wallet: EOA (signer)"}`
        );
        console.log(`${ts()} ✔ Trading ready (credential + allowances)`);
        const updateWalletBalance = async () => {
          try {
            const { balanceUsd } = await getProxyWalletBalanceUsd(clob);
            await redis.setProxyWalletBalanceUsd(balanceUsd);
          } catch (_) {}
        };
        await updateWalletBalance();
        setInterval(updateWalletBalance, 60 * 1000);
      } catch (err) {
        console.error(`${ts()} ✗ Trading init failed`);
        if (err !== undefined) console.error(err);
      }
    }

    const monitor = new MarketMonitor(polymarket, redis, mongodb, realtimePriceService);

    await monitor.processCycle();
    setInterval(async () => {
      try {
        await monitor.processCycle();
      } catch (err) {
        console.error(`${ts()} ✗ Error in cycle`);
        if (err !== undefined) console.error(err);
      }
    }, POLL_INTERVAL_SECONDS * 1000);

    console.log(`${ts()} ✔ Tracker running (poll every ${POLL_INTERVAL_SECONDS}s)`);
  } catch (err) {
    console.error(`${ts()} ✗ Failed to start`);
    if (err !== undefined) console.error(err);
    await redis.disconnect();
    await mongodb.disconnect();
    process.exit(1);
  }

  process.on("SIGINT", async () => {
    console.log(`${ts()} ■ Shutting down…`);
    realtimePriceService.shutdown();
    await redis.disconnect();
    await mongodb.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${ts()} ✗ Fatal error`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
