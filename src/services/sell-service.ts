/**
 * Sell service: execute sell (partial or full) for profit-lock exits.
 * Uses CLOB createAndPostOrder with Side.SELL, then reduces holdings.
 */

import { OrderType, Side } from "@polymarket/clob-client";
import { getClobClient } from "../providers/clobclient";
import { reduceHoldings } from "../utils/holdings";
import { tradingEnv } from "../config/env";
import type { RealtimePriceService } from "./realtime-price-service";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

export interface SellLogMeta {
  actionType?: string;
  reason?: string;
}

const TICK_SIZE = tradingEnv.TICK_SIZE;
const NEG_RISK = tradingEnv.NEG_RISK;

function clampPrice(price: number): number {
  const t = parseFloat(TICK_SIZE);
  return Math.max(t, Math.min(1 - t, price));
}

/**
 * Sell outcome tokens (market sell at best bid).
 * @param tokenId CLOB token ID (Up or Down)
 * @param shares Number of shares (tokens) to sell
 * @param conditionId Market conditionId (for holdings key)
 * @param realtimePriceService Optional; used for best bid
 * @param logMeta Optional; actionType/reason for profit-lock logging
 * @returns true if sold (at least partially), false on skip/failure
 */
export async function sellWinToken(
  tokenId: string,
  shares: number,
  conditionId: string,
  realtimePriceService?: RealtimePriceService | null,
  logMeta?: SellLogMeta
): Promise<boolean> {
  if (!tradingEnv.ENABLE_ML_BUY) return false;

  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    console.log(`${ts()} ⏭ Sell: PRIVATE_KEY not set`);
    return false;
  }

  if (shares <= 0) return false;

  try {
    const client = await getClobClient();

    let bestBid: number | null = null;
    if (realtimePriceService) {
      const priceResult = await realtimePriceService.getPrice(tokenId);
      if (priceResult) bestBid = priceResult.bestBid > 0 ? priceResult.bestBid : priceResult.mid;
    }
    if (bestBid == null || bestBid <= 0) {
      const priceResp = await client.getPrice(tokenId, "SELL");
      if (typeof priceResp === "number" && !Number.isNaN(priceResp)) bestBid = priceResp;
      else if (priceResp && typeof priceResp === "object") {
        const o = priceResp as Record<string, unknown>;
        const p = o.mid ?? o.price ?? o.SELL ?? o.bestBid;
        if (typeof p === "number" && !Number.isNaN(p)) bestBid = p;
      }
    }
    if (bestBid == null || bestBid <= 0) {
      console.error(`${ts()} ✗ Sell: could not get bid for token`);
      return false;
    }

    const sellPrice = clampPrice(Math.max(bestBid * 0.98, parseFloat(TICK_SIZE)));

    const marketOrder = {
      tokenID: tokenId,
      side: Side.SELL,
      amount: shares,
      price: sellPrice,
    };

    console.log(
      `${ts()} 💰 SELL ${shares.toFixed(2)} shares @ ${sellPrice.toFixed(2)} (bid ${bestBid.toFixed(2)})`
    );

    const result: any = await client.createAndPostMarketOrder(
      marketOrder,
      { tickSize: TICK_SIZE, negRisk: NEG_RISK },
      OrderType.FAK
    );

    const isSuccess =
      result &&
      (result.status === "FILLED" ||
        result.status === "PARTIALLY_FILLED" ||
        result.status === "matched" ||
        result.status === "MATCHED" ||
        !result.status);

    if (isSuccess) {
      let soldAmount = result.makingAmount ? parseFloat(result.makingAmount) : shares;
      if (soldAmount >= 1e6) soldAmount = soldAmount / 1e6;
      const reduced = reduceHoldings(conditionId, tokenId, soldAmount);
      const estimatedUsd = soldAmount * sellPrice;
      const actionPart = logMeta?.actionType ? ` actionType=${logMeta.actionType}` : "";
      const reasonPart = logMeta?.reason ? ` reason=${logMeta.reason}` : "";
      console.log(`${ts()} ✔ SELL: ${reduced.toFixed(2)} tokens`);
      console.log(
        `${ts()} ℹ [SELL] conditionId=${shortId(conditionId)} tokenId=${shortId(tokenId)} shares=${reduced.toFixed(2)} price=${sellPrice.toFixed(3)} bid=${bestBid.toFixed(3)} estimatedUsd=${estimatedUsd.toFixed(2)}${actionPart}${reasonPart}`
      );
      if (reduced > 0) return true;
      console.warn(`${ts()} ⚠ Sell filled but holdings not reduced (mismatch?)`);
      return true;
    }

    console.error(`${ts()} ✗ SELL: order not filled`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${ts()} ✗ SELL: ${msg}`);
    return false;
  }
}
