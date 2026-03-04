/**
 * Standalone bot: redeem all resolved (redeemable) positions in Polymarket.
 *
 * Uses Polymarket Data API (not CLOB):
 *   GET https://data-api.polymarket.com/positions?user=ADDRESS&redeemable=true
 * - redeemable=true returns only positions in resolved markets where you hold winning tokens.
 * - Each position has conditionId, size; we group by conditionId and call redeemPositions() once per condition.
 *
 * Runs every 500 seconds.
 *
 * Usage:
 *   npm run redeem-all-resolved
 *
 * Requires .env: PRIVATE_KEY, PROXY_WALLET_ADDRESS (or EOA that holds positions).
 */

import "dotenv/config";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { Wallet } from "@ethersproject/wallet";
import { tradingEnv, maskAddress } from "../config/env";
import { redeemMarket } from "../utils/redeem";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

const CHECK_INTERVAL_MS = 500 * 1000; // 500 seconds

const DATA_API_BASE = "https://data-api.polymarket.com";

/** Position from Data API GET /positions (see Polymarket docs). */
interface DataApiPosition {
  conditionId?: string;
  size?: number;
  redeemable?: boolean;
  asset?: string;
  title?: string;
  [k: string]: unknown;
}

async function getUserAddress(): Promise<string> {
  const proxy = (tradingEnv.PROXY_WALLET_ADDRESS ?? "").trim();
  if (proxy) return proxy;
  const pk = tradingEnv.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY or PROXY_WALLET_ADDRESS required");
  const wallet = new Wallet(pk);
  return wallet.getAddress();
}

/**
 * Fetch all redeemable positions for user from Data API.
 * Uses redeemable=true so only resolved markets with winning tokens are returned.
 * Paginates with limit=500 until no more results.
 */
async function fetchRedeemablePositions(userAddress: string): Promise<DataApiPosition[]> {
  const all: DataApiPosition[] = [];
  const limit = 500;
  let offset = 0;

  for (;;) {
    const url = `${DATA_API_BASE}/positions?user=${encodeURIComponent(userAddress)}&redeemable=true&sizeThreshold=0&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "PolymarketRedeemAllBot/1.0" },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Data API positions failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = (await res.json()) as unknown;
    const page = Array.isArray(data) ? data : [];
    const positions = page as DataApiPosition[];
    all.push(...positions);

    if (positions.length < limit) break;
    offset += limit;
  }

  return all;
}

/**
 * From redeemable positions, get unique conditionIds with size > 0.
 * One redeemPositions() call per conditionId.
 */
function getConditionIdsToRedeem(positions: DataApiPosition[]): string[] {
  const byCondition = new Map<string, boolean>();
  for (const p of positions) {
    const cid = typeof p.conditionId === "string" && p.conditionId.length > 0 ? p.conditionId : null;
    if (!cid) continue;
    const size = typeof p.size === "number" && !Number.isNaN(p.size) ? p.size : 0;
    if (size <= 0) continue;
    byCondition.set(cid, true);
  }
  return Array.from(byCondition.keys());
}

async function runCycle(userAddress: string): Promise<void> {
  const positions = await fetchRedeemablePositions(userAddress);
  const conditionIds = getConditionIdsToRedeem(positions);

  console.log(`${ts()} 💸 Fetched ${positions.length} redeemable position(s), ${conditionIds.length} unique condition(s) to redeem`);

  if (conditionIds.length === 0) {
    return;
  }

  console.log(`${ts()} 💸 Found ${conditionIds.length} resolved condition(s) to redeem: ${conditionIds.map((id) => shortId(id)).join(", ")}`);

  for (const conditionId of conditionIds) {
    try {
      await redeemMarket(conditionId);
      console.log(`${ts()} 💸 Redeemed ${shortId(conditionId)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${ts()} ✗ Failed to redeem ${shortId(conditionId)}: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  if (!tradingEnv.PRIVATE_KEY) {
    console.error(`${ts()} ✗ PRIVATE_KEY not set in .env`);
    process.exit(1);
  }

  const userAddress = await getUserAddress();
  console.log(`${ts()} ✔ Redeem-all-resolved bot started. User: ${maskAddress(userAddress)}, interval: ${CHECK_INTERVAL_MS / 1000}s`);

  const run = () => runCycle(userAddress).catch((err) => {
    console.error(`${ts()} ✗ Redeem cycle error`);
    if (err !== undefined) console.error(err);
  });

  await run();
  setInterval(run, CHECK_INTERVAL_MS);
}

main().catch((err) => {
  console.error(`${ts()} ✗ Fatal error`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
