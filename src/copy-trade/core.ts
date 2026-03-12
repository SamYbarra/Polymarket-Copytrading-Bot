/**
 * Shared copy-trade logic for both API polling and WebSocket.
 * Single source of truth: processTrade(trade). Only trade *fetch* differs per script.
 */

import { resolve } from "path";
import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { OrderType, Side, AssetType } from "@polymarket/clob-client";
import type { ClobClient } from "@polymarket/clob-client";
import { getClobClient } from "../providers/clobclient";
import { addHoldings, removeHoldings } from "../utils/holdings";
import { displayWalletBalance, getAvailableBalance, validateSellOrderBalance } from "../utils/balance";
import { notifyTelegramTargetTrade } from "../utils/telegram";
import { env } from "../config/env";
import { startMonitoring as riskManagerStart } from "./risk-manager";

const CONFIG_PATH = resolve(process.cwd(), "src/config/config.json");
let WALLET_ORDER_SIZE: Record<string, number> = {};
let TARGET_WALLETS: string[] = [];
if (existsSync(CONFIG_PATH)) {
    try {
        const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        if (typeof config === "object" && config !== null) {
            TARGET_WALLETS = Object.keys(config).filter((k) => typeof config[k] === "number");
            for (const k of Object.keys(config)) {
                if (typeof config[k] === "number") WALLET_ORDER_SIZE[k.toLowerCase()] = config[k];
            }
        }
    } catch (_) {}
}

export function getTargetWallets(): string[] {
    return TARGET_WALLETS;
}

export function getWalletOrderSize(): Record<string, number> {
    return WALLET_ORDER_SIZE;
}

const ORDER_TYPE = OrderType.FAK;
const TICK_SIZE = env.TICK_SIZE;
const NEG_RISK = env.NEG_RISK;
const ORDER_RETRY_ATTEMPTS = env.ORDER_RETRY_ATTEMPTS;
const ORDER_RETRY_DELAY_MS = env.ORDER_RETRY_DELAY_MS;
const BALANCE_REFRESH_MS = 150 * 1000;
const LOG_DIR = resolve(process.cwd(), "log");
export const LOG_FILE = resolve(LOG_DIR, "copytrade-api.log");
const PROCESSED_TRADES_FILE = resolve(LOG_DIR, "processed-trades.json");
const BOUGHT_TOKEN_IDS_FILE = resolve(LOG_DIR, "bought-token-ids.json");
const SOLD_TOKEN_IDS_FILE = resolve(LOG_DIR, "sold-token-ids.json");
const MAX_PROCESSED_TRADES = 10000;

let cachedAvailableUsdc: number | null = null;
let processedTrades: Set<string> = new Set();
let boughtTokenIds: Set<string> = new Set();
/** Markets we already sold; one buy+sell per market, never buy again. */
let soldTokenIds: Set<string> = new Set();
let tokenIdsBuyInProgress = new Set<string>();
let tradesDetected = 0;
let tradesCopied = 0;
let tradesFailed = 0;
let tradesSkipped = 0;

/** Pending BUY: token seen from target wallet but price was below BUY_THRESHOLD; monitor until price > threshold then buy. */
export interface PendingBuy {
    tokenId: string;
    conditionId: string;
    sourceWallet: string;
    transactionHash: string;
    configAmount: number;
    /** 5 or 15 depending on market; used for window boundary. */
    resolutionMinutes: 5 | 15;
    /** Window ends at next 5m or 15m boundary for this market. */
    windowEndMs: number;
}
const pendingBuys = new Map<string, PendingBuy>();
let pendingBuyCheckRunning = false;

function nextFiveMinuteBoundary(): number {
    const d = new Date();
    const min = d.getMinutes();
    const sec = d.getSeconds();
    const ms = d.getMilliseconds();
    const nextMin = min + (sec > 0 || ms > 0 ? 1 : 0);
    const next = Math.ceil(nextMin / 5) * 5;
    const target = new Date(d);
    if (next >= 60) {
        target.setHours(target.getHours() + 1);
        target.setMinutes(0, 0, 0);
    } else {
        target.setMinutes(next, 0, 0);
    }
    return target.getTime();
}

function nextFifteenMinuteBoundary(): number {
    const d = new Date();
    const min = d.getMinutes();
    const sec = d.getSeconds();
    const ms = d.getMilliseconds();
    const nextMin = min + (sec > 0 || ms > 0 ? 1 : 0);
    const next = Math.ceil(nextMin / 15) * 15;
    const target = new Date(d);
    if (next >= 60) {
        target.setHours(target.getHours() + 1);
        target.setMinutes(0, 0, 0);
    } else {
        target.setMinutes(next, 0, 0);
    }
    return target.getTime();
}

function nextBoundaryByResolution(resolutionMinutes: 5 | 15): number {
    return resolutionMinutes === 15 ? nextFifteenMinuteBoundary() : nextFiveMinuteBoundary();
}

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

export function logToFile(message: string) {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
}

function getTradeId(transactionHash: string, conditionId: string, asset: string): string {
    return `${transactionHash}-${conditionId}-${asset}`;
}

function tokenWalletKey(tokenId: string, sourceWallet?: string): string {
    return sourceWallet ? `${tokenId}:${sourceWallet.toLowerCase()}` : tokenId;
}

function clampPrice(price: number, tickSize: string): number {
    const t = parseFloat(tickSize);
    return Math.max(t, Math.min(1 - t, price));
}

const CRYPTO_KEYWORDS = ["btc", "bitcoin", "eth", "ethereum", "xrp", "ripple", "sol", "solana"];

export function isCryptoMarket(trade: { slug?: string; eventSlug?: string; title?: string }): boolean {
    const slug = (trade.slug || "").toLowerCase();
    const eventSlug = (trade.eventSlug || "").toLowerCase();
    const title = (trade.title || "").toLowerCase();
    return CRYPTO_KEYWORDS.some((k) => `${slug} ${eventSlug} ${title}`.includes(k));
}

/** Only 5m and 15m crypto markets; skip 1m, 4m, daily, hourly, weekly, etc. */
const ALLOWED_RESOLUTION_PATTERNS = [/\b15\s*[mM]\b/, /\b15-?min/, /\b5\s*[mM]\b/, /\b5-?min/];
const SKIP_RESOLUTION_PATTERNS = [/\b1\s*[mM]\b/, /\b1-?min\b/, /\b4\s*[mM]\b/, /\b4-?min\b/, /\b1\s*[dDhH]\b/, /\b1\s*[wW]\b/, /\bdaily\b/, /\bhourly\b/, /\bweekly\b/, /\bmonthly\b/, /\b4\s*[hH]\b/, /\b6\s*[hH]\b/];

export function is5mOr15mCryptoMarket(trade: { slug?: string; eventSlug?: string; title?: string }): boolean {
    if (!isCryptoMarket(trade)) return false;
    const combined = `${trade.slug || ""} ${trade.eventSlug || ""} ${trade.title || ""}`.toLowerCase();
    const combinedForAllowed = `${trade.slug || ""} ${trade.eventSlug || ""} ${trade.title || ""}`;
    for (const re of SKIP_RESOLUTION_PATTERNS) {
        if (re.test(combined)) return false;
    }
    for (const re of ALLOWED_RESOLUTION_PATTERNS) {
        if (re.test(combinedForAllowed)) return true;
    }
    return false;
}

/** 5 or 15 depending on market (from slug/eventSlug/title). Default 5. */
export function getMarketResolutionMinutes(trade: { slug?: string; eventSlug?: string; title?: string }): 5 | 15 {
    const combined = `${trade.slug || ""} ${trade.eventSlug || ""} ${trade.title || ""}`;
    if (/\b15\s*[mM]\b|\b15-?min/i.test(combined)) return 15;
    if (/\b5\s*[mM]\b|\b5-?min/i.test(combined)) return 5;
    return 5;
}

export function convertToTradePayload(item: any): TradeForProcess {
    return {
        asset: item.asset || "",
        conditionId: item.conditionId || "",
        eventSlug: item.eventSlug || "",
        outcome: item.outcome || "",
        outcomeIndex: item.outcomeIndex || 0,
        price: parseFloat(item.price || 0),
        proxyWallet: item.proxyWallet,
        side: item.side || "",
        size: parseFloat(item.size || 0),
        slug: item.slug || "",
        timestamp: item.timestamp || Math.floor(Date.now() / 1000),
        title: item.title || "",
        transactionHash: item.transactionHash || "",
        sourceWallet: item.sourceWallet || item.proxyWallet || "",
    };
}

export interface TradeForProcess {
    asset: string;
    conditionId: string;
    eventSlug?: string;
    outcome?: string;
    outcomeIndex?: number;
    price: number;
    proxyWallet?: string;
    side: string;
    size?: number;
    slug?: string;
    timestamp?: number;
    title?: string;
    transactionHash: string;
    sourceWallet?: string;
}

function isProcessed(transactionHash: string, conditionId: string, asset: string): boolean {
    return processedTrades.has(getTradeId(transactionHash, conditionId, asset));
}

function markTransactionAsSeen(transactionHash: string, conditionId: string, asset: string): void {
    processedTrades.add(getTradeId(transactionHash, conditionId, asset));
    if (processedTrades.size > MAX_PROCESSED_TRADES) {
        const entries = Array.from(processedTrades);
        processedTrades = new Set(entries.slice(-MAX_PROCESSED_TRADES));
    }
    saveProcessedTrades();
}

function isTokenAlreadyBought(tokenId: string, sourceWallet?: string): boolean {
    const key = tokenWalletKey(tokenId, sourceWallet);
    if (boughtTokenIds.has(key)) return true;
    return boughtTokenIds.has(tokenId);
}

function markAsProcessed(
    transactionHash: string,
    conditionId: string,
    asset: string,
    addToBought = false,
    sourceWallet?: string
): void {
    processedTrades.add(getTradeId(transactionHash, conditionId, asset));
    if (addToBought) boughtTokenIds.add(tokenWalletKey(asset, sourceWallet));
    if (processedTrades.size > MAX_PROCESSED_TRADES) {
        const entries = Array.from(processedTrades);
        processedTrades = new Set(entries.slice(-MAX_PROCESSED_TRADES));
    }
    saveProcessedTrades();
}

function isMarketAlreadySold(tokenId: string): boolean {
    return soldTokenIds.has(tokenId);
}

/** Call after any sell (copy-trade or risk-manager). One buy+sell per market, then never buy again. */
export function markMarketAsSold(tokenId: string): void {
    soldTokenIds.add(tokenId);
    try {
        writeFileSync(SOLD_TOKEN_IDS_FILE, JSON.stringify(Array.from(soldTokenIds), null, 2));
    } catch (e) {
        console.log("Failed to save sold token ids", e);
    }
}

/** Remove token so we can buy again after sell. If sourceWallet is set, remove only that wallet's entry (e.g. after failed buy). */
export function removeFromBoughtTokenIds(tokenId: string, sourceWallet?: string): void {
    if (sourceWallet !== undefined) {
        boughtTokenIds.delete(tokenWalletKey(tokenId, sourceWallet));
    } else {
        boughtTokenIds.delete(tokenId);
        for (const key of Array.from(boughtTokenIds)) {
            if (key.startsWith(tokenId + ":")) boughtTokenIds.delete(key);
        }
    }
    saveProcessedTrades();
}

function saveProcessedTrades(): void {
    try {
        writeFileSync(PROCESSED_TRADES_FILE, JSON.stringify(Array.from(processedTrades), null, 2));
        writeFileSync(BOUGHT_TOKEN_IDS_FILE, JSON.stringify(Array.from(boughtTokenIds), null, 2));
        writeFileSync(SOLD_TOKEN_IDS_FILE, JSON.stringify(Array.from(soldTokenIds), null, 2));
    } catch (e) {
        console.log("Failed to save processed trades", e);
    }
}

export function loadProcessedTrades(): void {
    if (existsSync(PROCESSED_TRADES_FILE)) {
        try {
            const data = JSON.parse(readFileSync(PROCESSED_TRADES_FILE, "utf-8"));
            if (Array.isArray(data)) {
                processedTrades = new Set(data);
                if (processedTrades.size > 0) console.log(`📚 Loaded ${processedTrades.size} processed trade(s)`);
            }
        } catch (_) {
            processedTrades = new Set();
        }
    }
    if (existsSync(BOUGHT_TOKEN_IDS_FILE)) {
        try {
            const data = JSON.parse(readFileSync(BOUGHT_TOKEN_IDS_FILE, "utf-8"));
            if (Array.isArray(data)) {
                boughtTokenIds = new Set(data);
                if (boughtTokenIds.size > 0) console.log(`📊 Loaded ${boughtTokenIds.size} bought (token, wallet) key(s)`);
            }
        } catch (_) {
            boughtTokenIds = new Set();
        }
    }
    if (existsSync(SOLD_TOKEN_IDS_FILE)) {
        try {
            const data = JSON.parse(readFileSync(SOLD_TOKEN_IDS_FILE, "utf-8"));
            if (Array.isArray(data)) {
                soldTokenIds = new Set(data);
                if (soldTokenIds.size > 0) console.log(`🚫 Loaded ${soldTokenIds.size} sold market(s) (one buy+sell per market)`);
            }
        } catch (_) {
            soldTokenIds = new Set();
        }
    }
}

export async function refreshCachedAvailableUsdc(client: ClobClient): Promise<void> {
    cachedAvailableUsdc = await getAvailableBalance(client, AssetType.COLLATERAL);
}

export function getStats() {
    return { tradesDetected, tradesCopied, tradesSkipped, tradesFailed };
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxAttempts = ORDER_RETRY_ATTEMPTS,
    delayMs = ORDER_RETRY_DELAY_MS,
    operationName = "operation"
): Promise<T> {
    let lastError: Error | unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const errorMsg = error instanceof Error ? error.message : String(error);
            const bodyErr = (error as any)?.response?.data?.error ?? (error as any)?.data?.error ?? "";
            const fullMsg = `${errorMsg} ${bodyErr}`;
            // FAK "no orders found to match" is retryable (liquidity may appear); only skip retry when orderbook truly missing
            const isNotRetryable =
                fullMsg.includes("No orderbook exists") ||
                (fullMsg.includes("orderbook") && fullMsg.includes("does not exist")) ||
                fullMsg.includes("404");
            if (isNotRetryable) throw error;
            const isRetryable =
                fullMsg.includes("no orders found") ||
                errorMsg.includes("no orders found") ||
                errorMsg.includes("Bad Request") ||
                errorMsg.includes("400") ||
                errorMsg.includes("network") ||
                errorMsg.includes("timeout") ||
                errorMsg.includes("ECONNREFUSED") ||
                errorMsg.includes("ETIMEDOUT") ||
                errorMsg.includes("RPC") ||
                errorMsg.includes("rate limit") ||
                errorMsg.includes("503") ||
                errorMsg.includes("502") ||
                errorMsg.includes("504") ||
                errorMsg.includes("connection");
            if (!isRetryable || attempt === maxAttempts) throw error;
            const delay = delayMs * Math.pow(2, attempt - 1);
            console.log(`⚠️  ${operationName} failed (attempt ${attempt}/${maxAttempts}): ${fullMsg.substring(0, 80)}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}

/**
 * Process one trade. Only BUY is copied from target wallet; SELL copy-trading is ignored.
 * Shared by API and WebSocket scripts. Trade must have sourceWallet or proxyWallet for config lookup.
 */
export async function processTrade(trade: TradeForProcess): Promise<void> {
    const side = (trade.side || "").toUpperCase();
    const sourceWallet = trade.sourceWallet || trade.proxyWallet;
    const conditionId = trade.conditionId;
    const tokenId = trade.asset;
    const transactionHash = trade.transactionHash;

    if (side !== "BUY" && side !== "SELL") return;
    if (side === "SELL") return;

    if (!is5mOr15mCryptoMarket(trade)) {
        tradesSkipped++;
        logToFile(`SKIPPED: Not 5m/15m crypto market - ${trade.slug || trade.eventSlug || "N/A"}`);
        return;
    }
    if (!sourceWallet || !(sourceWallet.toLowerCase() in WALLET_ORDER_SIZE)) {
        tradesSkipped++;
        logToFile(`SKIPPED: Wallet not in config - ${sourceWallet || "N/A"}`);
        return;
    }
    if (side === "BUY" && isMarketAlreadySold(tokenId)) {
        tradesSkipped++;
        logToFile(`SKIPPED: Market already sold (one buy+sell per market) - ${tokenId.substring(0, 14)}...`);
        return;
    }
    if (side === "BUY" && isTokenAlreadyBought(tokenId, sourceWallet)) {
        tradesSkipped++;
        logToFile(`SKIPPED: Already bought this token for this wallet - ${tokenId.substring(0, 14)}...`);
        return;
    }
    const buyInProgressKey = tokenWalletKey(tokenId, sourceWallet);
    if (side === "BUY" && tokenIdsBuyInProgress.has(buyInProgressKey)) {
        tradesSkipped++;
        logToFile(`SKIPPED: BUY in progress - ${tokenId.substring(0, 14)}...`);
        return;
    }
    const configAmount = WALLET_ORDER_SIZE[sourceWallet.toLowerCase()];
    if (side === "BUY" && (configAmount == null || configAmount <= 0)) {
        tradesSkipped++;
        logToFile(`SKIPPED: No order amount for wallet ${sourceWallet}`);
        return;
    }
    if (isProcessed(transactionHash, conditionId, tokenId)) {
        tradesSkipped++;
        logToFile(`SKIPPED: Already processed - ${transactionHash.substring(0, 10)}...`);
        return;
    }
    markTransactionAsSeen(transactionHash, conditionId, tokenId);
    if (side === "BUY") tokenIdsBuyInProgress.add(buyInProgressKey);
    void notifyTelegramTargetTrade(trade);

    const price = trade.price || 0;
    const t = parseFloat(TICK_SIZE);
    // Aggressive prices to prioritize fill: BUY at max (1-tick), SELL at min (tick)
    const orderPrice = side === "BUY" ? clampPrice(1 - t, TICK_SIZE) : clampPrice(t, TICK_SIZE);
    // config.json value: ORDER_SIZE_IN_TOKENS=true → token amount; else → fixed USDC
    const orderSizeTokens = side === "BUY" && env.ORDER_SIZE_IN_TOKENS ? configAmount! : undefined;
    let amountUsdc = 0;
    if (side === "BUY") {
        if (env.ORDER_SIZE_IN_TOKENS) {
            amountUsdc = Math.max(1, configAmount! * price);
        } else {
            // ORDER_SIZE_IN_TOKENS=false: config value = fixed USDC amount
            amountUsdc = Math.max(1, configAmount!);
        }
    }

    const t0 = Date.now();
    try {
        const client = await getClobClient();
        console.log(`   [perf] getClobClient: ${Date.now() - t0}ms`);

        const sourceWalletDisplay = sourceWallet ? ` [${sourceWallet.substring(0, 6)}...${sourceWallet.substring(38)}]` : "";

        // Validate balance only when ORDER_SIZE_IN_TOKENS (amount depends on price)
        if (env.ORDER_SIZE_IN_TOKENS) {
            const availableUsdc = await getAvailableBalance(client, AssetType.COLLATERAL);
            if (amountUsdc <= 0 || availableUsdc < amountUsdc) {
                if (availableUsdc < amountUsdc) {
                    tradesFailed++;
                    logToFile(`FAILED: Insufficient balance`);
                    return;
                }
            }
        }
        if (amountUsdc <= 0) {
            tradesSkipped++;
            logToFile(`SKIPPED: Invalid amount`);
            return;
        }

        let currentPrice: number | null = null;
        try {
            const priceResp = await client.getPrice(tokenId, "BUY");
            if (typeof priceResp === "number" && !Number.isNaN(priceResp)) {
                currentPrice = priceResp;
            } else if (typeof priceResp === "string") {
                const n = parseFloat(priceResp);
                currentPrice = Number.isNaN(n) ? null : n;
            } else if (priceResp && typeof priceResp === "object") {
                const o = priceResp as Record<string, unknown>;
                const p = o.price ?? o.mid ?? o.BUY;
                if (typeof p === "number" && !Number.isNaN(p)) currentPrice = p;
                else if (typeof p === "string") {
                    const n = parseFloat(p);
                    currentPrice = Number.isNaN(n) ? null : n;
                }
            }
        } catch (_) {
            console.log(`SKIPPED: Could not fetch token price for BUY_THRESHOLD check`);
            logToFile(`SKIPPED: Could not fetch token price for BUY_THRESHOLD check`);
            tradesSkipped++;
            return;
        }
        if (currentPrice === null || currentPrice < env.BUY_THRESHOLD) {
            const key = tokenWalletKey(tokenId, sourceWallet);
            if (!pendingBuys.has(key)) {
                const resolution = getMarketResolutionMinutes(trade);
                const now = Date.now();
                const windowEndMs = now + resolution * 60 * 1000;
                const t = new Date(windowEndMs);
                pendingBuys.set(key, {
                    tokenId,
                    conditionId,
                    sourceWallet,
                    transactionHash,
                    configAmount: configAmount!,
                    resolutionMinutes: resolution,
                    windowEndMs,
                });
                console.log(`📋 Pending BUY: tokenId ${tokenId.substring(0, 16)}... | ${resolution}m from now (until ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}) | price ${currentPrice ?? "?"} < ${env.BUY_THRESHOLD} → will buy when price > threshold`);
                logToFile(`PENDING_BUY: tokenId ${tokenId.substring(0, 20)}... price=${currentPrice} BUY_THRESHOLD=${env.BUY_THRESHOLD} resolution=${resolution}m`);
            }
            return;
        }

        console.log(`\n🟢 TRADE - BUY${sourceWalletDisplay} | ${trade.title || trade.slug} | $${amountUsdc.toFixed(2)} USDC`);
        console.log(`   CLOB price: ${currentPrice} (BUY_THRESHOLD: ${env.BUY_THRESHOLD})`);
        console.log(`   [perf] validation→ready: ${Date.now() - t0}ms`);

        if (isTokenAlreadyBought(tokenId, sourceWallet)) {
            tradesSkipped++;
            return;
        }

        const orderOptions = { tickSize: TICK_SIZE, negRisk: NEG_RISK };
        let lastAttemptAmountUsdc = amountUsdc;
        const tOrderStart = Date.now();
        const response: any = await retryWithBackoff(
            async () => {
                let orderAmountUsdc = amountUsdc;
                if (!env.ORDER_SIZE_IN_TOKENS) {
                    // Fixed USDC from config – no price fetch
                    orderAmountUsdc = amountUsdc;
                    lastAttemptAmountUsdc = amountUsdc;
                } else if (orderSizeTokens != null && orderSizeTokens > 0) {
                    try {
                        const currentPriceResp = await client.getPrice(tokenId, "BUY");
                        const currentPriceRaw =
                            typeof currentPriceResp === "number"
                                ? currentPriceResp
                                : (currentPriceResp?.price ?? currentPriceResp?.mid ?? price);
                        const currentPrice =
                            typeof currentPriceRaw === "number" && currentPriceRaw > 0
                                ? clampPrice(currentPriceRaw, TICK_SIZE)
                                : orderPrice;
                        if (typeof currentPrice === "number" && currentPrice > 0) {
                            orderAmountUsdc = Math.max(1, orderSizeTokens * currentPrice);
                            lastAttemptAmountUsdc = orderAmountUsdc;
                        }
                    } catch (_) {
                        orderAmountUsdc = lastAttemptAmountUsdc || amountUsdc;
                    }
                }
                const marketOrder = {
                    tokenID: tokenId,
                    side: Side.BUY,
                    amount: orderAmountUsdc,
                    price: orderPrice,
                    orderType: ORDER_TYPE as OrderType.FOK | OrderType.FAK,
                };
                const result = await client.createAndPostMarketOrder(marketOrder, orderOptions, ORDER_TYPE);
                if (result && typeof result === "object") {
                    if ((result as any).data?.error) throw new Error(`API Error: ${(result as any).data.error}`);
                    if ((result as any).status === 400) throw new Error(`Bad Request: ${(result as any).data?.error || "Unknown"}`);
                }
                return result;
            },
            ORDER_RETRY_ATTEMPTS,
            ORDER_RETRY_DELAY_MS,
            `BUY $${amountUsdc.toFixed(2)} USDC`
        );

        const isSuccess =
            response &&
            (response.status === "FILLED" ||
                response.status === "PARTIALLY_FILLED" ||
                response.status === "matched" ||
                response.status === "MATCHED" ||
                !response.status);

        console.log(`   [perf] order placement: ${Date.now() - tOrderStart}ms`);

        if (isSuccess) {
            tradesDetected++;
            tradesCopied++;
            let tokensReceived = response.takingAmount ? parseFloat(response.takingAmount) : lastAttemptAmountUsdc / price;
            if (tokensReceived >= 1e6) tokensReceived = tokensReceived / 1e6;
            const wasAlreadyBought = isTokenAlreadyBought(tokenId, sourceWallet);
            markAsProcessed(transactionHash, conditionId, tokenId, true, sourceWallet);
            if (!wasAlreadyBought) {
                try {
                    addHoldings(conditionId, tokenId, tokensReceived);
                } catch (_) {}
            }
            console.log(`✅ BUY | ${response.orderID || "N/A"} | ${tokensReceived.toFixed(2)} tokens @ price ${price} | processTrade: ${Date.now() - t0}ms`);
            riskManagerStart(tokenId, conditionId, price);
        } else {
            tradesFailed++;
            if (side === "BUY") removeFromBoughtTokenIds(tokenId, sourceWallet);
        }
    } catch (error) {
        tradesFailed++;
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`❌ ${msg.substring(0, 80)}`);
        logToFile(`FAILED: ${msg}`);
        if (side === "BUY") removeFromBoughtTokenIds(tokenId, sourceWallet);
    } finally {
        if (side === "BUY") tokenIdsBuyInProgress.delete(tokenWalletKey(tokenId, sourceWallet));
    }
}

function parsePriceFromResponse(priceResp: unknown): number | null {
    if (typeof priceResp === "number" && !Number.isNaN(priceResp)) return priceResp;
    if (typeof priceResp === "string") {
        const n = parseFloat(priceResp);
        return !Number.isNaN(n) ? n : null;
    }
    if (priceResp && typeof priceResp === "object") {
        const o = priceResp as Record<string, unknown>;
        const p = o.price ?? o.mid ?? o.BUY;
        if (typeof p === "number" && !Number.isNaN(p)) return p;
        if (typeof p === "string") {
            const n = parseFloat(p);
            return !Number.isNaN(n) ? n : null;
        }
    }
    return null;
}

async function executeBuyFromPending(client: ClobClient, pending: PendingBuy, currentPrice: number): Promise<boolean> {
    const key = tokenWalletKey(pending.tokenId, pending.sourceWallet);
    if (isMarketAlreadySold(pending.tokenId)) {
        pendingBuys.delete(key);
        return true;
    }
    if (isTokenAlreadyBought(pending.tokenId, pending.sourceWallet)) {
        pendingBuys.delete(key);
        return true;
    }
    tokenIdsBuyInProgress.add(key);
    const t = parseFloat(TICK_SIZE);
    const orderPrice = clampPrice(1 - t, TICK_SIZE);
    const amountUsdc = env.ORDER_SIZE_IN_TOKENS
        ? Math.max(1, pending.configAmount * currentPrice)
        : Math.max(1, pending.configAmount);
    const orderSizeTokens = env.ORDER_SIZE_IN_TOKENS ? pending.configAmount : undefined;
    let lastAttemptAmountUsdc = amountUsdc;
    try {
        const response: any = await retryWithBackoff(
            async () => {
                let orderAmountUsdc = amountUsdc;
                if (env.ORDER_SIZE_IN_TOKENS && orderSizeTokens != null && orderSizeTokens > 0) {
                    try {
                        const priceResp = await client.getPrice(pending.tokenId, "BUY");
                        const cp = parsePriceFromResponse(priceResp);
                        if (typeof cp === "number" && cp > 0) {
                            orderAmountUsdc = Math.max(1, orderSizeTokens * clampPrice(cp, TICK_SIZE));
                            lastAttemptAmountUsdc = orderAmountUsdc;
                        }
                    } catch (_) {
                        orderAmountUsdc = lastAttemptAmountUsdc || amountUsdc;
                    }
                }
                const marketOrder = {
                    tokenID: pending.tokenId,
                    side: Side.BUY,
                    amount: orderAmountUsdc,
                    price: orderPrice,
                    orderType: ORDER_TYPE as OrderType.FOK | OrderType.FAK,
                };
                const result = await client.createAndPostMarketOrder(marketOrder, { tickSize: TICK_SIZE, negRisk: NEG_RISK }, ORDER_TYPE);
                if (result && typeof result === "object") {
                    if ((result as any).data?.error) throw new Error(`API Error: ${(result as any).data.error}`);
                    if ((result as any).status === 400) throw new Error(`Bad Request: ${(result as any).data?.error || "Unknown"}`);
                }
                return result;
            },
            ORDER_RETRY_ATTEMPTS,
            ORDER_RETRY_DELAY_MS,
            `Pending BUY $${amountUsdc.toFixed(2)} USDC`
        );
        const isSuccess =
            response &&
            (response.status === "FILLED" ||
                response.status === "PARTIALLY_FILLED" ||
                response.status === "matched" ||
                response.status === "MATCHED" ||
                !response.status);
        if (isSuccess) {
            tradesDetected++;
            tradesCopied++;
            let tokensReceived = response.takingAmount ? parseFloat(response.takingAmount) : lastAttemptAmountUsdc / currentPrice;
            if (tokensReceived >= 1e6) tokensReceived = tokensReceived / 1e6;
            markAsProcessed(pending.transactionHash, pending.conditionId, pending.tokenId, true, pending.sourceWallet);
            try {
                addHoldings(pending.conditionId, pending.tokenId, tokensReceived);
            } catch (_) {}
            console.log(`✅ Pending BUY | ${response.orderID || "N/A"} | ${tokensReceived.toFixed(2)} tokens @ ${currentPrice} (price > BUY_THRESHOLD)`);
            logToFile(`PENDING_BUY_FILLED: tokenId ${pending.tokenId.substring(0, 20)}...`);
            riskManagerStart(pending.tokenId, pending.conditionId, currentPrice, pending.resolutionMinutes);
            pendingBuys.delete(key);
            return true;
        }
        removeFromBoughtTokenIds(pending.tokenId, pending.sourceWallet);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`Pending BUY failed ${pending.tokenId.substring(0, 14)}...: ${msg.substring(0, 50)}`);
        logToFile(`PENDING_BUY_FAILED: ${pending.tokenId.substring(0, 20)}... ${msg}`);
        removeFromBoughtTokenIds(pending.tokenId, pending.sourceWallet);
    } finally {
        tokenIdsBuyInProgress.delete(key);
    }
    return false;
}

/**
 * Check pending BUYs: if token price is now > BUY_THRESHOLD, place order and hand off to risk manager.
 * Each pending uses its own 5m or 15m window (windowEndMs, resolutionMinutes).
 */
export async function runPendingBuyCheck(): Promise<void> {
    if (pendingBuyCheckRunning) return;
    const now = Date.now();
    const timeThresholdMs = env.PENDING_BUY_TIME_THRESHOLD_SECONDS * 1000;
    if (pendingBuys.size === 0) return;
    pendingBuyCheckRunning = true;
    try {
        const client = await getClobClient();
        const toRemove: string[] = [];
        for (const [key, pending] of pendingBuys.entries()) {
            if (now >= pending.windowEndMs) {
                console.log(`📋 Pending BUY monitor: ${pending.resolutionMinutes}m window ended for tokenId ${pending.tokenId.substring(0, 16)}...`);
                toRemove.push(key);
                continue;
            }
            const windowStartMs = pending.windowEndMs - pending.resolutionMinutes * 60 * 1000;
            const elapsedMs = now - windowStartMs;
            const timeThresholdPassed = elapsedMs >= timeThresholdMs;
            try {
                const priceResp = await client.getPrice(pending.tokenId, "BUY");
                const price = parsePriceFromResponse(priceResp);
                if (price === null) continue;
                console.log(`📋 Pending BUY monitor: tokenId ${pending.tokenId.substring(0, 16)}... | price: ${price} | buy threshold: ${env.BUY_THRESHOLD} | time: ${(elapsedMs / 1000).toFixed(0)}s / ${env.PENDING_BUY_TIME_THRESHOLD_SECONDS}s (${pending.resolutionMinutes}m window)`);
                if (price > env.BUY_THRESHOLD && timeThresholdPassed) {
                    console.log(`🟢 Pending BUY trigger: tokenId ${pending.tokenId.substring(0, 16)}... price ${price} > ${env.BUY_THRESHOLD} and time >= ${env.PENDING_BUY_TIME_THRESHOLD_SECONDS}s`);
                    const done = await executeBuyFromPending(client, pending, price);
                    if (done) toRemove.push(key);
                } else if (price > env.BUY_THRESHOLD && !timeThresholdPassed) {
                    const waitSec = Math.ceil((timeThresholdMs - elapsedMs) / 1000);
                    console.log(`📋 Pending BUY: price OK, wait ${waitSec}s more (${(elapsedMs / 1000).toFixed(0)}s since previous ${pending.resolutionMinutes}m mark)`);
                }
            } catch (_) {
                // skip this pending item this tick
            }
        }
        for (const k of toRemove) pendingBuys.delete(k);
    } finally {
        pendingBuyCheckRunning = false;
    }
}

loadProcessedTrades();
