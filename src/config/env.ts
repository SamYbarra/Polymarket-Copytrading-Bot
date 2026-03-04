/**
 * Environment configuration for trading and redemption.
 * Requires PRIVATE_KEY, PROXY_WALLET_ADDRESS, and credential.json for trading.
 * Sensitive values are never logged.
 */

import { resolve } from "path";

/** Mask address for safe logging (0x1234...5678) */
export function maskAddress(addr: string): string {
  if (!addr || addr.length < 12) return "***";
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

const CHAIN_ID_DEFAULT = 137; // Polygon mainnet

function parseNum(value: string | undefined, defaultVal: number): number {
  if (value === undefined || value === "") return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

export const tradingEnv = {
  get PRIVATE_KEY(): string | undefined {
    return process.env.PRIVATE_KEY;
  },
  get CHAIN_ID(): number {
    return parseNum(process.env.CHAIN_ID, CHAIN_ID_DEFAULT);
  },
  get CLOB_API_URL(): string {
    return process.env.CLOB_API_URL || "https://clob.polymarket.com";
  },
  get PROXY_WALLET_ADDRESS(): string {
    return process.env.PROXY_WALLET_ADDRESS || "";
  },
  get RPC_URL(): string | undefined {
    return process.env.RPC_URL;
  },
  get RPC_TOKEN(): string | undefined {
    return process.env.RPC_TOKEN;
  },
  get TICK_SIZE(): "0.01" | "0.1" {
    const v = process.env.TICK_SIZE;
    return v === "0.1" ? "0.1" : "0.01";
  },
  get NEG_RISK(): boolean {
    return process.env.NEG_RISK === "true";
  },
  get ML_BUY_AMOUNT_USD(): number {
    const v = process.env.ML_BUY_AMOUNT_USD;
    const n = parseFloat(v || "5");
    return Number.isNaN(n) ? 5 : Math.max(1, n);
  },
  get ML_BUY_MIN_CONFIDENCE(): number {
    const v = process.env.ML_BUY_MIN_CONFIDENCE;
    const n = parseFloat(v || "0.7");
    return Number.isNaN(n) ? 0.7 : Math.max(0.5, Math.min(1, n));
  },
  /** When predicting at PREDICTION_TIME_MIN (earliest time), require confidence above this to buy. Default 0.8 (80%). */
  get ML_BUY_MIN_CONFIDENCE_AT_EARLY_TIME(): number {
    const v = process.env.ML_BUY_MIN_CONFIDENCE_AT_EARLY_TIME;
    const n = parseFloat(v || "0.8");
    return Number.isNaN(n) ? 0.8 : Math.max(0.5, Math.min(1, n));
  },
  get ENABLE_ML_BUY(): boolean {
    return process.env.ENABLE_ML_BUY !== "false";
  },
  get ENABLE_AUTO_REDEEM(): boolean {
    return process.env.ENABLE_AUTO_REDEEM !== "false";
  },
  get SAFE_DELTA(): number {
    const v = process.env.SAFE_DELTA;
    const n = parseFloat(v || "100");
    return Number.isFinite(n) ? Math.max(0, n) : 100;
  },
  get BUY_PRICE_MIN(): number {
    const v = process.env.BUY_PRICE_MIN;
    const n = parseFloat(v || "0.35");
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.35;
  },
  get BUY_PRICE_MAX(): number {
    const v = process.env.BUY_PRICE_MAX;
    const n = parseFloat(v || "0.8");
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
  },
  /** Max allowed spread (bestAsk - bestBid). Skip buy if spread larger. 0 = disabled. Default 0. */
  get BUY_MAX_SPREAD(): number {
    const v = process.env.BUY_MAX_SPREAD;
    if (v === undefined || v === "") return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(1, n) : 0;
  },
  get BUY_SHARES(): number {
    const v = process.env.BUY_SHARES;
    const n = parseInt(v || "5", 10);
    return Number.isFinite(n) ? Math.max(1, n) : 5;
  },
  /** When true, allow buying on ensemble fallback (ML down); when false, never buy on ensemble. */
  get ENSEMBLE_BUY_ALLOWED(): boolean {
    return process.env.ENSEMBLE_BUY_ALLOWED === "true";
  },
  /** Min confidence to buy when using ensemble (only if ENSEMBLE_BUY_ALLOWED). Default 0.85. */
  get ENSEMBLE_MIN_CONFIDENCE(): number {
    const v = process.env.ENSEMBLE_MIN_CONFIDENCE;
    const n = parseFloat(v || "0.85");
    return Number.isFinite(n) ? Math.max(0.5, Math.min(1, n)) : 0.85;
  },
};

export const realtimePriceEnv = {
  get WS_URL(): string {
    return process.env.REALTIME_PRICE_WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market";
  },
  get PING_INTERVAL_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_PING_INTERVAL_MS || "10000", 10);
  },
  get PONG_TIMEOUT_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_PONG_TIMEOUT_MS || "15000", 10);
  },
  get RECONNECT_INITIAL_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_RECONNECT_INITIAL_MS || "1000", 10);
  },
  get RECONNECT_MAX_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_RECONNECT_MAX_MS || "30000", 10);
  },
  get HTTP_POLL_INTERVAL_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_HTTP_POLL_INTERVAL_MS || "2000", 10);
  },
  get CACHE_STALE_MS(): number {
    return parseInt(process.env.REALTIME_PRICE_CACHE_STALE_MS || "2000", 10);
  },
};

export function getRpcUrl(chainId: number): string {
  if (tradingEnv.RPC_URL) {
    const url = tradingEnv.RPC_URL.trim();
    if (url.startsWith("wss://")) return url.replace(/^wss:\/\//, "https://");
    if (url.startsWith("ws://")) return url.replace(/^ws:\/\//, "http://");
    return url;
  }
  if (chainId === 137) {
    if (tradingEnv.RPC_TOKEN) return `https://polygon-mainnet.g.alchemy.com/v2/${tradingEnv.RPC_TOKEN}`;
    return "https://polygon-mainnet.g.alchemy.com/v2/FbusKhKX_DJoZ_Wnf13b6DMV7MNCVBKB";
  }
  if (chainId === 80002) {
    if (tradingEnv.RPC_TOKEN) return `https://polygon-amoy.g.alchemy.com/v2/${tradingEnv.RPC_TOKEN}`;
    return "https://rpc-amoy.polygon.technology";
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}
