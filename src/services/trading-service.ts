/**
 * Trading service: execute buy order for predicted outcome.
 * Buy/no-buy decision (confidence, price, delta) is made in market-monitor.makePrediction();
 * this only executes the order (or records simulation when ENABLE_ML_BUY is false).
 */

import { OrderType, Side } from "@polymarket/clob-client";
import { PolymarketClient } from "../clients/polymarket";
import { getClobClient } from "../providers/clobclient";
import { addHoldings } from "../utils/holdings";
import { validateBuyOrderBalance } from "../utils/balance";
import { tradingEnv } from "../config/env";
import type { MarketInfo, MlBuyDoc } from "../types";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};
import type { MongoDBClient } from "../clients/mongodb";
import type { RealtimePriceService } from "./realtime-price-service";

const TICK_SIZE = tradingEnv.TICK_SIZE;
const NEG_RISK = tradingEnv.NEG_RISK;
const ORDER_TYPE = OrderType.FAK;

function clampPrice(price: number): number {
  const t = parseFloat(TICK_SIZE);
  return Math.max(t, Math.min(1 - t, price));
}

/**
 * Buy win token for predicted outcome.
 * Always buys BUY_SHARES shares; amount = BUY_SHARES * currentPrice (best ask).
 * Uses RealtimePriceService for live price when provided; falls back to CLOB getPrice.
 * When mongodb is provided and buy succeeds, saves to ml_buys collection.
 */
export async function buyWinToken(
  polymarket: PolymarketClient,
  conditionId: string,
  marketInfo: MarketInfo,
  predictedOutcome: "Up" | "Down",
  confidence: number,
  mongodb?: MongoDBClient,
  realtimePriceService?: RealtimePriceService | null,
  meta?: { btcOpen?: number; currentBtc?: number; delta?: number }
): Promise<boolean> {
  if (!tradingEnv.ENABLE_ML_BUY) {

    return false;
  }

  const privateKey = tradingEnv.PRIVATE_KEY;
  const proxyWallet = tradingEnv.PROXY_WALLET_ADDRESS;
  if (!privateKey || !proxyWallet) {
    console.log(`${ts()} ⏭ ML buy: PRIVATE_KEY or PROXY_WALLET_ADDRESS not set`);
    return false;
  }

  const { upTokenId, downTokenId } = await polymarket.getMarketTokenIds(
    marketInfo.eventSlug,
    conditionId
  );
  const tokenId = predictedOutcome === "Up" ? upTokenId : downTokenId;
  if (!tokenId) {
    console.error(`${ts()} ✗ ML buy: no token ID for ${predictedOutcome}`);
    return false;
  }

  const t = parseFloat(TICK_SIZE);

  try {
    const client = await getClobClient();

    let currentPrice: number | null = null;

    if (realtimePriceService) {
      const priceResult = await realtimePriceService.getPrice(tokenId);
      if (priceResult) {
        currentPrice = priceResult.bestAsk > 0 ? priceResult.bestAsk : priceResult.mid;
      }
    }

    if (currentPrice === null || currentPrice <= 0) {
      const priceResp = await client.getPrice(tokenId, "BUY");
      if (typeof priceResp === "number" && !Number.isNaN(priceResp)) {
        currentPrice = priceResp;
      } else if (typeof priceResp === "string") {
        const n = parseFloat(priceResp);
        currentPrice = Number.isNaN(n) ? null : n;
      } else if (priceResp && typeof priceResp === "object") {
        const o = priceResp as Record<string, unknown>;
        const p = o.mid ?? o.price ?? o.BUY;
        if (typeof p === "number" && !Number.isNaN(p)) currentPrice = p;
        else if (typeof p === "string") currentPrice = parseFloat(p);
      }
    }

    if (currentPrice === null || currentPrice <= 0) {
      console.error(`${ts()} ✗ ML buy: could not fetch price for token`);
      return false;
    }

    const orderLimitCap = 0.90;
    const candidate = currentPrice ;
    const orderPrice = clampPrice(Math.min(candidate, orderLimitCap));

    if (true){

      const orderAmountUsdc = tradingEnv.BUY_SHARES * currentPrice;

      const { valid } = await validateBuyOrderBalance(client, orderAmountUsdc);
      if (!valid) {
        console.log(`${ts()} ⏭ ML buy: insufficient balance/allowance`);
        return false;
      }
   
      const marketOrder = {
        tokenID: tokenId,
        side: Side.BUY,
        amount: orderAmountUsdc,
        price: orderPrice,
        orderType: ORDER_TYPE as OrderType.FAK,
      };
  
      console.log(
        `${ts()} 💰 ${predictedOutcome} ${tradingEnv.BUY_SHARES} shares @ ${currentPrice.toFixed(2)} = $${orderAmountUsdc.toFixed(2)} (${(confidence * 100).toFixed(1)}% conf)`
      );
  
      const result: any = await client.createAndPostMarketOrder(
        marketOrder,
        { tickSize: TICK_SIZE, negRisk: NEG_RISK },
        ORDER_TYPE
      );
  
      const isSuccess =
        result &&
        (result.status === "FILLED" ||
          result.status === "PARTIALLY_FILLED" ||
          result.status === "matched" ||
          result.status === "MATCHED" ||
          !result.status);
  
      if (isSuccess) {
        let tokensReceived = result.takingAmount ? parseFloat(result.takingAmount) : orderAmountUsdc / currentPrice;
        if (tokensReceived >= 1e6) tokensReceived = tokensReceived / 1e6;
        const boughtAt = Math.floor(Date.now() / 1000);
        addHoldings(conditionId, tokenId, tokensReceived);
        if (mongodb) {
          const doc: MlBuyDoc = {
            conditionId,
            eventSlug: marketInfo.eventSlug,
            predictedOutcome,
            confidence,
            outcomePrice: currentPrice,
            shares: tradingEnv.BUY_SHARES,
            amountUsd: orderAmountUsdc,
            boughtAt,
            ...(meta?.btcOpen != null && { btcOpen: meta.btcOpen }),
            ...(meta?.currentBtc != null && { currentBtc: meta.currentBtc }),
            ...(meta?.delta != null && { delta: meta.delta }),
          };
          await mongodb.saveMlBuy(doc).catch((err) => {
            console.error(`${ts()} ✗ saveMlBuy failed`);
            if (err !== undefined) console.error(err);
          });
        }
        console.log(`${ts()} ✔ ML BUY: ${tokensReceived.toFixed(2)} ${predictedOutcome} tokens`);
        const btcPart =
          meta?.btcOpen != null && meta?.currentBtc != null && meta?.delta != null
            ? ` btcOpen=${meta.btcOpen.toFixed(2)} currentBtc=${meta.currentBtc.toFixed(2)} delta=${meta.delta.toFixed(2)}`
            : "";
        console.log(
          `${ts()} ℹ [BUY] conditionId=${shortId(conditionId)} eventSlug=${marketInfo.eventSlug} outcome=${predictedOutcome} confidence=${(confidence * 100).toFixed(1)}% entryPrice=${currentPrice.toFixed(3)} shares=${tokensReceived.toFixed(2)} amountUsd=${orderAmountUsdc.toFixed(2)} tokenId=${shortId(tokenId)} boughtAt=${boughtAt}${btcPart}`
        );
        return true;
      }
    }
    // else{
    //   const orderAmountUsdc = tradingEnv.BUY_SHARES * currentPrice;

    //   const { valid } = await validateBuyOrderBalance(client, orderAmountUsdc);
    //   if (!valid) {
    //     logger.skip("ML buy: insufficient balance/allowance");
    //     return false;
    //   }
   
    //   const limitOrder = {
    //     tokenID: tokenId,
    //     side: Side.BUY,
    //     size: tradingEnv.BUY_SHARES/0.8,
    //     price: 0.8,
    //   };

    //   logger.buy(
    //     `${predictedOutcome} ${tradingEnv.BUY_SHARES} shares @ ${currentPrice.toFixed(2)} = $${orderAmountUsdc.toFixed(2)} (${(confidence * 100).toFixed(1)}% conf)`
    //   );

    //   const result: any = await client.createAndPostOrder(
    //     limitOrder,
    //     { tickSize: TICK_SIZE, negRisk: NEG_RISK },
    //     OrderType.GTC
    //   );
  
    //   const isSuccess =
    //     result &&
    //     (result.status === "FILLED" ||
    //       result.status === "PARTIALLY_FILLED" ||
    //       result.status === "matched" ||
    //       result.status === "MATCHED" ||
    //       !result.status);
  
    //   if (isSuccess) {
    //     let tokensReceived = result.takingAmount ? parseFloat(result.takingAmount) : orderAmountUsdc / currentPrice;
    //     if (tokensReceived >= 1e6) tokensReceived = tokensReceived / 1e6;
    //     addHoldings(conditionId, tokenId, tokensReceived);
    //     if (mongodb) {
    //       const doc: MlBuyDoc = {
    //         conditionId,
    //         eventSlug: marketInfo.eventSlug,
    //         predictedOutcome,
    //         confidence,
    //         outcomePrice: currentPrice,
    //         shares: tradingEnv.BUY_SHARES,
    //         amountUsd: orderAmountUsdc,
    //         boughtAt: Math.floor(Date.now() / 1000),
    //         ...(meta?.btcOpen != null && { btcOpen: meta.btcOpen }),
    //         ...(meta?.currentBtc != null && { currentBtc: meta.currentBtc }),
    //         ...(meta?.delta != null && { delta: meta.delta }),
    //       };
    //       await mongodb.saveMlBuy(doc).catch((err) => logger.error("saveMlBuy failed", err));
    //     }
    //     logger.ok(`ML BUY: ${tokensReceived.toFixed(2)} ${predictedOutcome} tokens`);
   
    //   }

    //   return true;
    // }
   

    console.error(`${ts()} ✗ ML BUY: order not filled`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${ts()} ✗ ML BUY: ${msg}`);
    return false;
  }
}
