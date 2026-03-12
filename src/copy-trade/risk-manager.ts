/**
 * Risk manager: after we buy a token, monitor its price until the next 5-minute clock
 * (0m, 5m, 10m, … 55m). If price drops below SELL_PRICE, sell immediately.
 * Stops at the boundary; restarts when the bot buys again.
 */

import { OrderType, Side, AssetType } from "@polymarket/clob-client";
import type { ClobClient } from "@polymarket/clob-client";
import { getClobClient } from "../providers/clobclient";
import { env } from "../config/env";
import { validateSellOrderBalance } from "../utils/balance";
import { removeHoldings } from "../utils/holdings";
import { removeFromBoughtTokenIds, markMarketAsSold, logToFile } from "./core";

const TICK_SIZE = env.TICK_SIZE;
const NEG_RISK = env.NEG_RISK;
const ORDER_TYPE = env.ORDER_TYPE === "FOK" ? OrderType.FOK : OrderType.FAK;

/** Monitored token: conditionId, buy price, and window end (per-token 5m or 15m). */
const monitored = new Map<string, { conditionId: string; buyPrice: number; windowEndMs: number }>();
/** Prevent overlapping runRiskCheck calls. */
let riskCheckRunning = false;

function clampPrice(price: number): number {
    const t = parseFloat(TICK_SIZE);
    return Math.max(t, Math.min(1 - t, price));
}

/** Next 5-minute boundary (0, 5, 10, … 55) as timestamp. */
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

/** Next 15-minute boundary (0, 15, 30, 45) as timestamp. */
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

/**
 * Call when the bot buys a token. Starts monitoring for exactly 5m or 15m from now (independent per trade).
 * buyPrice: token price at buy time (for logging).
 * resolutionMinutes: 5 or 15; default 5.
 */
export function startMonitoring(tokenId: string, conditionId: string, buyPrice: number, resolutionMinutes: 5 | 15 = 5): void {
    const now = Date.now();
    const windowEndMs = now + resolutionMinutes * 60 * 1000;
    const t = new Date(windowEndMs);
    monitored.set(tokenId, { conditionId, buyPrice, windowEndMs });
    console.log(`🛡️ Risk manager: monitoring tokenId ${tokenId.substring(0, 16)}... | ${resolutionMinutes}m from now (until ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}) | buy: ${buyPrice} | sell if < ${env.SELL_PRICE}`);
    logToFile(`RISK: Start monitoring tokenId ${tokenId.substring(0, 20)}... buyPrice=${buyPrice} SELL_PRICE=${env.SELL_PRICE} resolution=${resolutionMinutes}m`);
}

/** Max attempts for risk sell: retry until success or this many tries (no price = place immediately). */
const RISK_SELL_MAX_ATTEMPTS = 50;
const RISK_SELL_DELAY_CAP_MS = 1000;

/** Sell ASAP: no price field so order places immediately; retry until success or max attempts. */
async function sellToken(client: ClobClient, tokenId: string, conditionId: string, _limitPrice: number): Promise<boolean> {
    const balanceCheck = await validateSellOrderBalance(client, tokenId, 0);
    const available = balanceCheck.available;
    if (available <= 0) {
        logToFile(`RISK: No tokens to sell - ${tokenId.substring(0, 14)}...`);
        return false;
    }
    try {
        await client.updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: tokenId });
    } catch (_) {}
    const sellOrder = {
        tokenID: tokenId,
        side: Side.SELL,
        amount: available,
        orderType: ORDER_TYPE as OrderType.FOK | OrderType.FAK,
    };
    const orderOptions = { tickSize: TICK_SIZE, negRisk: NEG_RISK };
    for (let attempt = 1; attempt <= RISK_SELL_MAX_ATTEMPTS; attempt++) {
        try {
            const response: any = await client.createAndPostMarketOrder(sellOrder, orderOptions, ORDER_TYPE);
            const rawStatus = response?.status ?? response?.data?.status;
            const status = rawStatus != null ? String(rawStatus).toUpperCase() : "";
            const ok =
                response &&
                (status === "FILLED" ||
                    status === "PARTIALLY_FILLED" ||
                    status === "MATCHED" ||
                    status === "PARTIALLY_MATCHED" ||
                    !rawStatus);
            if (ok) {
                const makingAmount = response?.makingAmount ?? response?.data?.makingAmount;
                const tokensSold = makingAmount != null ? parseFloat(String(makingAmount)) : available;
                removeFromBoughtTokenIds(tokenId);
                markMarketAsSold(tokenId);
                try {
                    removeHoldings(conditionId, tokenId, tokensSold);
                } catch (e) {
                    logToFile(`RISK HOLDINGS: ${e instanceof Error ? e.message : String(e)}`);
                }
                console.log(`🛡️ Risk sell: tokenId ${tokenId.substring(0, 14)}... (${tokensSold.toFixed(2)} shares) [attempt ${attempt}]`);
                logToFile(`RISK SELL: tokenId ${tokenId.substring(0, 18)}... (one buy+sell per market)`);
                return true;
            }
            const errMsg = response?.data?.error ?? response?.error ?? rawStatus ?? "unknown";
            console.log(`🛡️ Risk sell attempt ${attempt}/${RISK_SELL_MAX_ATTEMPTS}: not filled status=${rawStatus ?? "null"}`);
            logToFile(`RISK SELL RETRY: attempt ${attempt} tokenId ${tokenId.substring(0, 18)}... error=${String(errMsg).slice(0, 80)}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`🛡️ Risk sell attempt ${attempt}/${RISK_SELL_MAX_ATTEMPTS} failed: ${msg.substring(0, 60)}`);
            logToFile(`RISK SELL RETRY: attempt ${attempt} tokenId ${tokenId.substring(0, 18)}... ${msg}`);
        }
        if (attempt < RISK_SELL_MAX_ATTEMPTS) {
            const delayMs = Math.min(env.ORDER_RETRY_DELAY_MS * Math.pow(2, attempt - 1), RISK_SELL_DELAY_CAP_MS);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    console.log(`Risk sell gave up after ${RISK_SELL_MAX_ATTEMPTS} attempts for ${tokenId.substring(0, 14)}...`);
    logToFile(`RISK SELL GAVE UP: tokenId ${tokenId.substring(0, 18)}... after ${RISK_SELL_MAX_ATTEMPTS} attempts`);
    return false;
}

function toNum(v: unknown): number | null {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
        const n = parseFloat(v);
        return !Number.isNaN(n) ? n : null;
    }
    return null;
}

function parsePrice(priceResp: unknown): number | null {
    const n = toNum(priceResp);
    if (n !== null) return n;
    if (priceResp && typeof priceResp === "object") {
        const o = priceResp as Record<string, unknown>;
        const p = o.price ?? o.mid ?? o.sellPrice ?? o.SELL ?? o.BUY;
        const pn = toNum(p);
        if (pn !== null) return pn;
        // Nested map: { [tokenId]: { SELL: "0.52" } } — take first value's SELL/BUY
        const firstVal = Object.values(o)[0];
        if (firstVal && typeof firstVal === "object") {
            const inner = firstVal as Record<string, unknown>;
            const innerP = inner.SELL ?? inner.BUY ?? inner.price ?? inner.mid;
            return toNum(innerP);
        }
    }
    return null;
}

/**
 * Run one risk check: for each token, if past its window end remove it; else
 * fetch sell price and sell if price < SELL_PRICE. Call this periodically (e.g. every 20s).
 */
export async function runRiskCheck(): Promise<void> {
    if (riskCheckRunning) return;
    riskCheckRunning = true;
    try {
        const now = Date.now();
        const toRemove: string[] = [];
        for (const [tokenId, { windowEndMs }] of monitored.entries()) {
            if (now >= windowEndMs) {
                console.log(`🛡️ Risk manager: window ended for tokenId ${tokenId.substring(0, 16)}...`);
                toRemove.push(tokenId);
            }
        }
        for (const id of toRemove) monitored.delete(id);
        if (monitored.size === 0) return;

        let client: ClobClient;
        try {
            client = await getClobClient();
        } catch (e) {
            return;
        }

        const toRemovePrice: string[] = [];
        for (const [tokenId, { conditionId, buyPrice }] of monitored.entries()) {
            try {
                const priceResp = await client.getPrice(tokenId, "SELL");
                const price = parsePrice(priceResp);
                if (price === null) {
                    const raw = typeof priceResp === "object" && priceResp !== null ? JSON.stringify(priceResp).slice(0, 120) : String(priceResp).slice(0, 80);
                    console.log(`🛡️ Risk manager: could not get price for tokenId ${tokenId.substring(0, 16)}... (response: ${raw})`);
                    toRemovePrice.push(tokenId);
                    continue;
                }
                console.log(`🛡️ Risk manager: tokenId ${tokenId.substring(0, 16)}... | buy: ${buyPrice} | current: ${price} | sell if < ${env.SELL_PRICE} or >= ${env.PROFIT_SELL_THRESHOLD}`);
                if (price >= env.PROFIT_SELL_THRESHOLD) {
                    console.log(`🛡️ Risk manager: price ${price} >= ${env.PROFIT_SELL_THRESHOLD} (profit cap) → selling immediately`);
                    const sold = await sellToken(client, tokenId, conditionId, price);
                    toRemovePrice.push(tokenId);
                } else if (price < env.SELL_PRICE) {
                    console.log(`🛡️ Risk manager: price ${price} < ${env.SELL_PRICE} → selling`);
                    const sold = await sellToken(client, tokenId, conditionId, price);
                    toRemovePrice.push(tokenId);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.log(`🛡️ Risk manager: getPrice/sell failed for ${tokenId.substring(0, 16)}...: ${msg.substring(0, 50)}`);
                toRemovePrice.push(tokenId);
            }
        }
        for (const id of toRemovePrice) {
            monitored.delete(id);
        }
    } finally {
        riskCheckRunning = false;
    }
}
