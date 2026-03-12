/**
 * Central environment configuration.
 * Load .env once and access all variables from here for easier management.
 *
 * Copy .env.example to .env and fill in your values.
 */

import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";

// Load .env from project root (only first import runs this)
dotenvConfig({ path: resolve(process.cwd(), ".env") });

export type TickSize = "0.1" | "0.01" | "0.001" | "0.0001";
export type OrderTypeEnv = "FAK" | "FOK";

/** Polygon mainnet */
const CHAIN_ID_DEFAULT = 137;

function parseNum(value: string | undefined, defaultVal: number): number {
    if (value === undefined || value === "") return defaultVal;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? defaultVal : n;
}

/**
 * Central env object – single source of truth for all environment variables.
 */
export const env = {
    // --- Wallet & chain ---
    /** Private key of the trading wallet (required for trading/redemption). */
    get PRIVATE_KEY(): string | undefined {
        return process.env.PRIVATE_KEY;
    },

    /** Chain ID (137 = Polygon mainnet, 80002 = Amoy testnet). */
    get CHAIN_ID(): number {
        return parseNum(process.env.CHAIN_ID, CHAIN_ID_DEFAULT);
    },

    /** Polymarket CLOB API base URL. */
    get CLOB_API_URL(): string {
        return process.env.CLOB_API_URL || "https://clob.polymarket.com";
    },

    /** Proxy (smart) wallet address used by Polymarket for this EOA. */
    get PROXY_WALLET_ADDRESS(): string {
        return process.env.PROXY_WALLET_ADDRESS || "0xcbb677ebf16eb7b1d372499edaf01cb6b083de9b";
    },

    // --- RPC ---
    /** Override RPC URL. If set, RPC_TOKEN is ignored for the URL. */
    get RPC_URL(): string | undefined {
        return process.env.RPC_URL;
    },

    /** Alchemy (or similar) API token; used to build RPC URL if RPC_URL is not set. */
    get RPC_TOKEN(): string | undefined {
        return process.env.RPC_TOKEN;
    },

    // --- Trading (copy trade & order builder) ---
    /** Order type: FAK (fill-and-kill) or FOK (fill-or-kill). */
    get ORDER_TYPE(): OrderTypeEnv {
        const v = process.env.ORDER_TYPE?.toUpperCase();
        return v === "FOK" ? "FOK" : "FAK";
    },

    /** Price tick size: 0.1, 0.01, 0.001, or 0.0001. */
    get TICK_SIZE(): TickSize {
        const v = process.env.TICK_SIZE as TickSize | undefined;
        const allowed: TickSize[] = ["0.1", "0.01", "0.001", "0.0001"];
        return v && allowed.includes(v) ? v : "0.01";
    },

    /** Use negative-risk exchange. */
    get NEG_RISK(): boolean {
        return process.env.NEG_RISK === "true";
    },

    /**
     * If true, config.json amounts are token/share counts (USDC = amount × price).
     * If false, BUY uses available USDC wallet balance (\"all-in\"), ignoring config size.
     */
    get ORDER_SIZE_IN_TOKENS(): boolean {
        return process.env.ORDER_SIZE_IN_TOKENS !== "false";
    },

    /** If true, config.json amounts = fixed USDC. No balance check, no price fetch. Fast path. */
    get ORDER_SIZE_IN_USDC(): boolean {
        return process.env.ORDER_SIZE_IN_USDC === "true";
    },

    /** Enable/disable copy trading (index.ts). */
    get ENABLE_COPY_TRADING(): boolean {
        return process.env.ENABLE_COPY_TRADING !== "false";
    },

    /** When true, no orders are placed (log only). Set to false to enable real buy/sell. */
    get DRY_RUN(): boolean {
        return process.env.DRY_RUN !== "false";
    },

    /** Auto-redemption interval in minutes (null = disabled). */
    get REDEEM_DURATION(): number | null {
        const v = process.env.REDEEM_DURATION || "120";
        if (v === undefined || v === "") return null;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n <= 0 ? null : n;
    },

    // --- API copy-trade (copytrade-api.ts) ---
    /** Poll interval in ms for fetching transactions. */
    get POLL_INTERVAL_MS(): number {
        return parseNum(process.env.POLL_INTERVAL_MS, 1 * 100) || 30000;
    },

    /** Delay in ms between each wallet API request (rate limit). */
    get WALLET_FETCH_DELAY_MS(): number {
        return parseNum(process.env.WALLET_FETCH_DELAY_MS, 800) || 800;
    },

    /** BUY slippage in basis points (100 = 1%, 200 = 2%). We pay up to this much above trade price to improve fill. Default 200. */
    get BUY_SLIPPAGE_BPS(): number {
        const v = process.env.BUY_SLIPPAGE_BPS;
        if (v === undefined || v === "") return 200;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 200 : Math.min(1000, n);
    },

    /** SELL slippage in basis points (100 = 1%). We accept this much below mid to improve fill. Default 100. */
    get SELL_SLIPPAGE_BPS(): number {
        const v = process.env.SELL_SLIPPAGE_BPS;
        if (v === undefined || v === "") return 100;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 100 : Math.min(500, n);
    },

    /** Only copy BUY when target trade token price is strictly above this (e.g. 0.5). */
    get BUY_THRESHOLD(): number {
        const v = process.env.BUY_THRESHOLD;
        if (v === undefined || v === "") return 0.5;
        const n = parseFloat(v);
        return Number.isNaN(n) ? 0.5 : n;
    },

    /** Risk manager: sell token immediately when its price drops below this (e.g. 0.45). */
    get SELL_PRICE(): number {
        const v = process.env.SELL_PRICE;
        if (v === undefined || v === "") return 0.45;
        const n = parseFloat(v);
        return Number.isNaN(n) || n <= 0 ? 0.45 : n;
    },

    /** Sell immediately when token price reaches this (e.g. 0.98); do not hold for more. */
    get PROFIT_SELL_THRESHOLD(): number {
        const v = process.env.PROFIT_SELL_THRESHOLD;
        if (v === undefined || v === "") return 0.98;
        const n = parseFloat(v);
        return Number.isNaN(n) ? 0.98 : Math.max(0, Math.min(1, n));
    },

    /** Pending BUY: only buy when price > BUY_THRESHOLD and at least this many seconds have passed since the previous 5-minute boundary (default 210s). */
    get PENDING_BUY_TIME_THRESHOLD_SECONDS(): number {
        const v = process.env.PENDING_BUY_TIME_THRESHOLD_SECONDS;
        if (v === undefined || v === "") return 210;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 210 : n;
    },

    /** Number of retries for order placement. */
    get ORDER_RETRY_ATTEMPTS(): number {
        return parseNum(process.env.ORDER_RETRY_ATTEMPTS, 5) || 5;
    },

    /** Delay in ms between order retry attempts. */
    get ORDER_RETRY_DELAY_MS(): number {
        return parseNum(process.env.ORDER_RETRY_DELAY_MS, 200) || 200;
    },

    // --- Real-time / WebSocket ---
    /** WebSocket URL for Polymarket real-time data (activity/trades). */
    get USER_REAL_TIME_DATA_URL(): string {
        return process.env.USER_REAL_TIME_DATA_URL || "wss://ws-live-data.polymarket.com";
    },

    // --- Telegram (optional, fire-and-forget) ---
    /** Telegram bot token for target trade notifications. If unset, notifications are skipped. */
    get TELEGRAM_BOT_TOKEN(): string | undefined {
        return process.env.TELEGRAM_BOT_TOKEN || undefined;
    },
    /** Telegram chat ID to send notifications to. */
    get TELEGRAM_CHAT_ID(): string | undefined {
        return process.env.TELEGRAM_CHAT_ID || undefined;
    },

    // --- Scripts / debug ---
    /** Enable debug logging. */
    get DEBUG(): boolean {
        return process.env.DEBUG === "true";
    },

    /** Condition ID for manual redeem script. */
    get CONDITION_ID(): string | undefined {
        return process.env.CONDITION_ID;
    },

    /** Index sets for manual redeem script (comma-separated). */
    get INDEX_SETS(): string | undefined {
        return process.env.INDEX_SETS;
    },
};

/**
 * Build RPC URL for a given chain ID.
 * Uses env.RPC_URL if set, otherwise builds from env.RPC_TOKEN or default endpoints.
 * If RPC_URL is a WebSocket URL (wss:// or ws://), converts to HTTPS so JsonRpcProvider can use it.
 */
export function getRpcUrl(chainId: number): string {
    if (env.RPC_URL) {
        const url = env.RPC_URL.trim();
        if (url.startsWith("wss://")) return url.replace(/^wss:\/\//, "https://");
        if (url.startsWith("ws://")) return url.replace(/^ws:\/\//, "http://");
        return url;
    }

    if (chainId === 137) {
        if (env.RPC_TOKEN) return `https://polygon-mainnet.g.alchemy.com/v2/${env.RPC_TOKEN}`;
        return "https://polygon-mainnet.g.alchemy.com/v2/Ag-cC4rPDzO7TbKw3Uaqj";
    }
    if (chainId === 80002) {
        if (env.RPC_TOKEN) return `https://polygon-amoy.g.alchemy.com/v2/${env.RPC_TOKEN}`;
        return "https://rpc-amoy.polygon.technology";
    }

    throw new Error(`Unsupported chain ID: ${chainId}. Supported: 137 (Polygon), 80002 (Amoy)`);
}
