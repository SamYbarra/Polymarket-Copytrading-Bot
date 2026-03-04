/**
 * Config from env. No dependency on parent src.
 * Loads .env from trade-bot-v2 directory (works when run from repo root or from trade-bot-v2).
 */

import { resolve } from "path";
import { config as dotenv } from "dotenv";

// Prefer .env in trade-bot-v2 (package dir); fallback to cwd for flexibility
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
  /** Polymarket CLOB WebSocket (market data). */
  WS_URL: process.env.REALTIME_PRICE_WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  /** CLOB API host for orders. */
  CLOB_HOST: process.env.CLOB_API_URL || "https://clob.polymarket.com",
  CHAIN_ID: int(process.env.CHAIN_ID, 137),
  /** Polygon RPC for on-chain approve. Optional: RPC_URL or RPC_TOKEN (Alchemy). */
  RPC_URL: (process.env.RPC_URL ?? "").trim() || undefined,
  RPC_TOKEN: (process.env.RPC_TOKEN ?? "").trim() || undefined,
  PRIVATE_KEY: process.env.PRIVATE_KEY ?? "",
  PROXY_WALLET: process.env.PROXY_WALLET_ADDRESS ?? "",
  TICK_SIZE: (process.env.TICK_SIZE === "0.1" ? "0.1" : "0.01") as "0.01" | "0.1",
  NEG_RISK: process.env.NEG_RISK === "true",

  /** Credential path (Polygon signing). From repo root: src/data/credential.json. */
  CREDENTIAL_PATH: process.env.CREDENTIAL_PATH || "src/data/credential.json",

  /** 5m window (same as backend: MARKET_WINDOW_MINUTES). */
  WINDOW_SEC: (() => {
    const min = int(process.env.MARKET_WINDOW_MINUTES, 5);
    return min * 60;
  })(),
  /** BTC 5m slug prefix (same as backend). Must be btc-updown-5m- for Polymarket BTC 5m. Use eth-updown-5m- for ETH 5m. */
  SLUG_PREFIX: (process.env.MARKET_SLUG_PREFIX || "btc-updown-5m-").trim() || "btc-updown-5m-",

  /** Asset used for velocity ($/s). Env VELOCITY_ASSET=btc|eth, or derived from SLUG_PREFIX (prefix starts with "eth" → eth, else btc). */
  VELOCITY_ASSET: ((): "btc" | "eth" => {
    const v = (process.env.VELOCITY_ASSET ?? "").toLowerCase();
    if (v === "eth" || v === "btc") return v;
    const prefix = (process.env.MARKET_SLUG_PREFIX || "btc-updown-5m-").trim();
    return prefix.startsWith("eth") ? "eth" : "btc";
  })(),

  /** Only buy when best ask in (MIN, MAX). */
  BUY_PRICE_MIN: num(process.env.BUY_PRICE_MIN, 0.4),
  BUY_PRICE_MAX: num(process.env.BUY_PRICE_MAX, 0.8),
  /** When velocity is strongly favorable, allow buy up to this price (method 1+2: wider band / chase). Default 0.92. */
  BUY_PRICE_MAX_FAVORABLE: num(process.env.BUY_PRICE_MAX_FAVORABLE, 0.92),
  /** Min velocity $/s (favorable for outcome) to use wider band or chase. Default 8. */
  VELOCITY_FAVORABLE_FOR_WIDER_BAND: num(process.env.VELOCITY_FAVORABLE_FOR_WIDER_BAND, 8),
  /** When buying in wider band or chase, use this fraction of BUY_AMOUNT_USD (e.g. 0.5 = half). */
  BUY_AMOUNT_FAVORABLE_RATIO: num(process.env.BUY_AMOUNT_FAVORABLE_RATIO, 0.5),
  MIN_CONFIDENCE: num(process.env.MIN_CONFIDENCE, 0.65),
  /** Buy size in USD. Shares = BUY_AMOUNT_USD / token price (best ask). */
  BUY_AMOUNT_USD: num(process.env.BUY_AMOUNT_USD ?? process.env.BUY_SHARES, 5),
  /** After buy: post limit sell at this price for all tokens. */
  LIMIT_SELL_PRICE: num(process.env.LIMIT_SELL_PRICE, 0.97),
  /** Sell order type when flattening or profit-lock selling: "market" (immediate) or "limit" (post at price). */
  SELL_ORDER_TYPE: (process.env.SELL_ORDER_TYPE || "market").toLowerCase() === "limit" ? "limit" : "market",

  /** No predict/buy before this many seconds after market start. */
  PREDICTION_MIN_ELAPSED_SEC: int(process.env.PREDICTION_MIN_ELAPSED_SECONDS, 150),
  /** Never buy after this many seconds after market start (e.g. 270 = 4 min 30 s). */
  BUY_MAX_ELAPSED_SEC: int(process.env.BUY_MAX_ELAPSED_SECONDS, 270),

  /** Enable live trading. */
  ENABLE_TRADING: process.env.ENABLE_TRADING !== "false",
  /** When true: run buy logic but skip sending the order (ML/dry-run only). */
  ENABLE_ML_BUY: process.env.ENABLE_ML_BUY === "true",

  /** Optional: Redis URL for ML features (realtime:features:{conditionId}). When set, bot uses ML/ensemble prediction if collector is running. */
  REDIS_URL: (process.env.REDIS_URL ?? "").trim() || undefined,
  /** Optional: ML service predict endpoint (e.g. http://localhost:8000). POST JSON features, expect { predictedOutcome, confidence }. When unset, uses embedded ensemble. */
  ML_SERVICE_URL: (process.env.ML_SERVICE_URL ?? "").replace(/\/$/, "") || undefined,

  /** Price stream ping/pong. */
  PING_MS: int(process.env.WS_PING_MS, 8000),
  PONG_TIMEOUT_MS: int(process.env.WS_PONG_TIMEOUT_MS, 12000),
  /** Reconnect: initial delay (ms). Avoid 2s to prevent hammering. */
  WS_RECONNECT_INITIAL_MS: int(process.env.WS_RECONNECT_INITIAL_MS, 5000),
  WS_RECONNECT_MAX_MS: int(process.env.WS_RECONNECT_MAX_MS, 30000),
  /** How often to check pong timeout (ms). */
  WS_PONG_CHECK_MS: int(process.env.WS_PONG_CHECK_MS, 5000),

  /** Main loop: decision + profit lock interval (ms). Speed first. */
  LOOP_MS: int(process.env.BOT_LOOP_MS, 100),

  /** Profit lock: if mid price exceeds this, sell all remaining (in any case). Default 0.97. */
  PROFIT_LOCK_SELL_ALL_ABOVE: num(process.env.PROFIT_LOCK_SELL_ALL_ABOVE, 0.97),
  /** Profit lock: flatten remaining at this many minutes elapsed. */
  FLATTEN_BY_MIN: num(process.env.FLATTEN_BY_MIN, 4.5),
  /** Profit lock: first target alpha (fraction of max payoff). */
  ALPHA1: num(process.env.PL_ALPHA1, 0.20),
  ALPHA2: num(process.env.PL_ALPHA2, 0.50),
  R1: num(process.env.PL_R1, 0.30),
  R2: num(process.env.PL_R2, 0.50),
  TRAIL_MIN: num(process.env.PL_TRAIL_MIN, 0.025),
  TRAIL_MAX: num(process.env.PL_TRAIL_MAX, 0.10),
  COLLAPSE_THRESHOLD: num(process.env.PL_COLLAPSE, 0.10),
  /** When leftTimeSec <= this, use normal collapse threshold (stricter near resolution). */
  RESOLUTION_SOON_SEC: int(process.env.RESOLUTION_SOON_SEC, 60),
  /** T2 boost when velocity favorable: max extra alpha (e.g. 0.15 → T2 target higher). */
  PL_T2_BOOST_MAX_ALPHA: num(process.env.PL_T2_BOOST_MAX_ALPHA, 0.15),
  /** T2 boost: extra alpha per $/s favorable velocity (e.g. 0.01 → 10 $/s adds 0.1 alpha). */
  PL_T2_BOOST_VELOCITY_SCALE: num(process.env.PL_T2_BOOST_VELOCITY_SCALE, 0.01),

  /** BTC velocity risk layer. $/s over VELOCITY_WINDOW_SEC. At ~$100k BTC: 5 $/s ≈ $150 in 30s (0.15%), 15 $/s ≈ 0.45%. */
  VELOCITY_ENABLED: process.env.VELOCITY_ENABLED !== "false",
  VELOCITY_WINDOW_SEC: int(process.env.VELOCITY_WINDOW_SEC, 30),
  /** Skip buy whenever velocity direction is adverse for the chosen outcome (Up + BTC down, or Down + BTC up). If false, block only when adverse and velocityAbs >= VELOCITY_BLOCK_USD_PER_SEC. */
  VELOCITY_SKIP_BUY_ON_ANY_ADVERSE: process.env.VELOCITY_SKIP_BUY_ON_ANY_ADVERSE === "true",
  VELOCITY_BLOCK_USD_PER_SEC: num(process.env.VELOCITY_BLOCK_USD_PER_SEC, 15),
  VELOCITY_REDUCE_USD_PER_SEC: num(process.env.VELOCITY_REDUCE_USD_PER_SEC, 8),
  VELOCITY_TIGHTEN_USD_PER_SEC: num(process.env.VELOCITY_TIGHTEN_USD_PER_SEC, 5),
  /** When velocity is favorable but projected move (leftTimeSec * velocity) < this ($), tighten profit lock (insufficient momentum). */
  INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD: num(process.env.INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD, 50),
  BTC_SAMPLE_INTERVAL_MS: int(process.env.BTC_SAMPLE_INTERVAL_MS, 10_000),

  /** Chainlink Data Streams: BTC price for velocity (WebSocket). Required for velocity layer. */
  CHAINLINK_DS_WS_URL: process.env.CHAINLINK_DS_WS_URL || "wss://ws.dataengine.chain.link",
  CHAINLINK_DS_API_URL: process.env.CHAINLINK_DS_API_URL || "https://api.dataengine.chain.link",
  /** BTC/USD feed ID (hex, e.g. from data.chain.link). Required when VELOCITY_ENABLED. */
  CHAINLINK_DS_FEED_ID_BTC_USD: process.env.CHAINLINK_DS_FEED_ID_BTC_USD || "",
  CHAINLINK_DS_API_KEY: process.env.CHAINLINK_DS_API_KEY || "",
  CHAINLINK_DS_USER_SECRET: process.env.CHAINLINK_DS_USER_SECRET || "",

  /** When velocity is high: flatten at this fraction of FLATTEN_BY_MIN. */
  FLATTEN_TIGHTEN_MULT: num(process.env.FLATTEN_TIGHTEN_MULT, 0.7),
  /** When velocity is high: trail distance multiplier (wider trail = lock sooner). */
  TRAIL_TIGHTEN_MULT: num(process.env.TRAIL_TIGHTEN_MULT, 1.5),
};

/** Polygon RPC URL for on-chain approve. Uses RPC_URL, or Alchemy when RPC_TOKEN set, or default. */
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
