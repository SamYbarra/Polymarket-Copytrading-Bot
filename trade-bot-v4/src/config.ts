/**
 * Config for trade-bot-v4: limit buy both sides @ 0.45 at open, sell if < 0.15, auto-redeem.
 */

import { resolve } from "path";
import { config as dotenv } from "dotenv";

const packageDir = resolve(__dirname, "..");
const packageEnv = resolve(packageDir, ".env");
const cwdEnv = resolve(process.cwd(), ".env");
dotenv({ path: packageEnv });
if (cwdEnv !== packageEnv) dotenv({ path: cwdEnv });

const num = (v: string | undefined, d: number): number => {
  if (v == null || v === "") return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

const int = (v: string | undefined, d: number): number => {
  if (v == null || v === "") return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  WS_URL: process.env.REALTIME_PRICE_WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  CLOB_HOST: process.env.CLOB_API_URL || "https://clob.polymarket.com",
  CHAIN_ID: int(process.env.CHAIN_ID, 137),
  RPC_URL: (process.env.RPC_URL ?? "").trim() || undefined,
  RPC_TOKEN: (process.env.RPC_TOKEN ?? "").trim() || undefined,
  PRIVATE_KEY: process.env.PRIVATE_KEY ?? "",
  PROXY_WALLET: process.env.PROXY_WALLET_ADDRESS ?? "",
  TICK_SIZE: (process.env.TICK_SIZE === "0.1" ? "0.1" : "0.01") as "0.01" | "0.1",
  NEG_RISK: process.env.NEG_RISK === "true",

  CREDENTIAL_PATH: process.env.CREDENTIAL_PATH || "src/data/credential.json",

  WINDOW_SEC: (() => {
    const min = int(process.env.MARKET_WINDOW_MINUTES, 5);
    return min * 60;
  })(),
  SLUG_PREFIX: (process.env.MARKET_SLUG_PREFIX || "btc-updown-5m-").trim() || "btc-updown-5m-",

  /** Limit buy price for both Up and Down at market open. */
  BUY_LIMIT_PRICE: num(process.env.BUY_LIMIT_PRICE, 0.45),
  /** Buy size in USD per side. Shares = BUY_AMOUNT_USD / BUY_LIMIT_PRICE. */
  BUY_AMOUNT_USD: num(process.env.BUY_AMOUNT_USD ?? process.env.BUY_SHARES, 5),
  /** Only place limit buys when elapsed since market start is within this many seconds (default 60 = first 1 minute). */
  BUY_WINDOW_SEC: int(process.env.BUY_WINDOW_SEC, 60),

  /** Sell position when mid price < this (stop-loss). */
  SELL_IF_BELOW: num(process.env.SELL_IF_BELOW, 0.15),
  /** When stop-loss selling, place sell at (price - SELL_LAG), e.g. 0.12 → 0.11 if SELL_LAG=0.01. */
  SELL_LAG: num(process.env.SELL_LAG, 0.01),

  /** After market end, attempt redeem when condition is resolved. */
  AUTO_REDEEM: process.env.AUTO_REDEEM !== "false",

  ENABLE_TRADING: process.env.ENABLE_TRADING !== "false",

  PING_MS: int(process.env.WS_PING_MS, 8000),
  PONG_TIMEOUT_MS: int(process.env.WS_PONG_TIMEOUT_MS, 12000),
  WS_RECONNECT_INITIAL_MS: int(process.env.WS_RECONNECT_INITIAL_MS, 5000),
  WS_RECONNECT_MAX_MS: int(process.env.WS_RECONNECT_MAX_MS, 30000),
  WS_PONG_CHECK_MS: int(process.env.WS_PONG_CHECK_MS, 5000),
  LOOP_MS: int(process.env.BOT_LOOP_MS, 500),
};

export function getRpcUrl(chainId: number): string {
  if (config.RPC_URL) {
    const url = config.RPC_URL;
    if (url.startsWith("wss://")) return url.replace(/^wss:\/\//, "https://");
    if (url.startsWith("ws://")) return url.replace(/^ws:\/\//, "http://");
    return url;
  }
  if (chainId === 137) {
    if (config.RPC_TOKEN) return `https://polygon-mainnet.g.alchemy.com/v2/${config.RPC_TOKEN}`;
    return "https://polygon-mainnet.g.alchemy.com/v2/FbusKhKX_DJoZ_Wnf13b6DMV7MNCVBKB";
  }
  if (chainId === 80002) {
    if (config.RPC_TOKEN) return `https://polygon-amoy.g.alchemy.com/v2/${config.RPC_TOKEN}`;
    return "https://rpc-amoy.polygon.technology";
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}
