/**
 * Config for trade-bot-v3: 0.35 strategy, GTD buy, sell at 0.4 / 0.5.
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

  /** 0.35 strategy: limit buy at this price (GTD). */
  BUY_TARGET_PRICE: num(process.env.BUY_TARGET_PRICE, 0.35),
  /** GTD order lifetime in seconds (e.g. 150 = 2 min 30 s). Polymarket requires +60s buffer, so we use expiration = now + GTD_BUFFER_SEC + GTD_LIFETIME_SEC. */
  GTD_LIFETIME_SEC: int(process.env.GTD_LIFETIME_SEC, 150),
  /** Buffer added to GTD expiration (Polymarket minimum 60s). */
  GTD_BUFFER_SEC: int(process.env.GTD_BUFFER_SEC, 60),
  /** Which side to buy: "Up" | "Down" | "auto" (auto = side with lower ask). */
  TARGET_OUTCOME: (process.env.TARGET_OUTCOME || "auto").toLowerCase() as "up" | "down" | "auto",
  /** Buy size in USD. Limit order size (shares) = BUY_AMOUNT_USD / BUY_TARGET_PRICE. */
  BUY_AMOUNT_USD: num(process.env.BUY_AMOUNT_USD ?? process.env.BUY_SHARES, 5),

  /** Sell 50% when mid >= SELL_T1_PRICE (default 0.4). */
  SELL_T1_PRICE: num(process.env.SELL_T1_PRICE, 0.4),
  SELL_T1_RATIO: num(process.env.SELL_T1_RATIO, 0.5),
  /** Sell remaining 50% when mid >= SELL_T2_PRICE (default 0.5). */
  SELL_T2_PRICE: num(process.env.SELL_T2_PRICE, 0.5),
  SELL_T2_RATIO: num(process.env.SELL_T2_RATIO, 0.5),

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
