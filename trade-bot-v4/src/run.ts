/**
 * Trade bot v4: limit buy both sides @ 0.45 at open, sell if price < 0.15, auto-redeem when resolved.
 */

import { config } from "./config";
import { MarketPriceStream } from "./price/market-price-stream";
import { getCurrentMarket, getCurrentWindowTs, getSlugForCurrentWindow } from "./data/market-data";
import { limitBuyGTC, getOrder, marketSell, cancelOrder, getClobClient } from "./executor/market-executor";
import { runApprove } from "./security/allowance";
import { createCredential } from "./security/createCredential";
import { checkConditionResolution, redeemMarket } from "./redeem/redeem";
import type { MarketInfo, PositionState } from "./types";

const ts = () => new Date().toISOString();
const log = (msg: string) => console.log(`${ts()} ${msg}`);
const logErr = (msg: string, e?: unknown) => {
  console.error(`${ts()} ${msg}`);
  if (e != null) console.error(e);
};

/** CLOB returns order sizes in 6 decimals (e.g. "11100000" = 11.1). Convert to human shares. */
function parseClobSize(value: string | undefined): number {
  if (!value || !value.trim()) return 0;
  const n = parseFloat(value.trim());
  if (Number.isNaN(n)) return 0;
  if (value.includes(".")) return n;
  return n / 1e6;
}

async function main(): Promise<void> {
  log("Trade bot v4 starting (limit buy both @ 0.45 at open, sell if < 0.15, auto-redeem)");

  if (config.ENABLE_TRADING && config.PRIVATE_KEY) {
    try {
      await createCredential();
      const clob = getClobClient();
      log("Auto-approve on startup…");
      await runApprove(clob);
      log("Trading ready");
    } catch (e) {
      logErr("Trading init failed", e);
    }
  }

  const priceStream = new MarketPriceStream();
  let market: { marketInfo: MarketInfo; upTokenId: string; downTokenId: string } | null = null;
  let currentSlug: string | null = null;
  let positionUp: PositionState | null = null;
  let positionDown: PositionState | null = null;
  let pendingUpOrderId: string | null = null;
  let pendingDownOrderId: string | null = null;
  /** So we place orders only once per market at open. */
  let ordersPlacedThisMarket = false;
  /** One placement attempt per token per market (don't block the other if one fails). */
  let upOrderAttemptedThisMarket = false;
  let downOrderAttemptedThisMarket = false;
  /** ConditionIds we already attempted redeem for (avoid spam). */
  const redeemAttemptedConditionIds = new Set<string>();

  const subscribeToMarket = (m: { marketInfo: MarketInfo; upTokenId: string; downTokenId: string }) => {
    market = m;
    currentSlug = getSlugForCurrentWindow();
    pendingUpOrderId = null;
    pendingDownOrderId = null;
    ordersPlacedThisMarket = false;
    upOrderAttemptedThisMarket = false;
    downOrderAttemptedThisMarket = false;
    const windowStartSec = getCurrentWindowTs();
    const endTimeSec = windowStartSec + config.WINDOW_SEC;
    log(`[SWITCH] subscribe slug=${currentSlug} conditionId=${m.marketInfo.conditionId.slice(0, 18)}…`);
    priceStream.subscribe([m.upTokenId, m.downTokenId], {
      marketEndTimeSec: endTimeSec,
      onMarketClosed: async () => {
        const next = await getCurrentMarket();
        if (!next) return null;
        if (next.marketInfo.conditionId === market!.marketInfo.conditionId) return null;
        log(`[SWITCH] next market slug=${getSlugForCurrentWindow()} conditionId=${next.marketInfo.conditionId.slice(0, 18)}…`);
        market = next;
        currentSlug = getSlugForCurrentWindow();
        pendingUpOrderId = null;
        pendingDownOrderId = null;
        ordersPlacedThisMarket = false;
        upOrderAttemptedThisMarket = false;
        downOrderAttemptedThisMarket = false;
        return { tokenIds: [next.upTokenId, next.downTokenId], marketEndTimeSec: getCurrentWindowTs() + config.WINDOW_SEC };
      },
    });
  };

  const refreshMarket = async (): Promise<void> => {
    try {
      const m = await getCurrentMarket();
      if (!m) return;
      if (!market) {
        log("[SWITCH] discovered market, subscribing");
        subscribeToMarket(m);
      }
    } catch (e) {
      logErr("Market refresh", e);
    }
  };

  await refreshMarket();
  if (market) {
    await priceStream.whenReady();
    log("Price stream ready");
  } else {
    log(`No current market yet (slug=${getSlugForCurrentWindow()}); loop will retry.`);
  }

  const loopMs = config.LOOP_MS;
  let lastMarketRefresh = 0;
  const WINDOW_CHECK_MS = 5000;

  const loop = async (): Promise<void> => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    if (!market && now - lastMarketRefresh > 10_000) {
      lastMarketRefresh = now;
      refreshMarket().catch((e) => logErr("Market refresh", e));
    }
    if (!market) return;

    const { marketInfo, upTokenId, downTokenId } = market;

    // Stale positions from previous market
    let hadStale = false;
    if (positionUp && positionUp.conditionId !== marketInfo.conditionId) {
      const toSell = Math.floor((positionUp.remainingShares - 0.01) * 100) / 100;
      if (toSell > 0) {
        const sellPrice = positionUp.entryPrice * 0.95;
        const res = await marketSell(positionUp.tokenId, toSell, sellPrice);
        if (res.ok) log(`[SELL] flatten_after_switch Up shares=${toSell}`);
        else logErr(`[SELL] failed flatten_after_switch Up`);
      }
      positionUp = null;
      hadStale = true;
    }
    if (positionDown && positionDown.conditionId !== marketInfo.conditionId) {
      const toSell = Math.floor((positionDown.remainingShares - 0.01) * 100) / 100;
      if (toSell > 0) {
        const sellPrice = positionDown.entryPrice * 0.95;
        const res = await marketSell(positionDown.tokenId, toSell, sellPrice);
        if (res.ok) log(`[SELL] flatten_after_switch Down shares=${toSell}`);
        else logErr(`[SELL] failed flatten_after_switch Down`);
      }
      positionDown = null;
      hadStale = true;
    }
    if (hadStale) return;

    // Past market end: cancel orders, flatten, then try redeem
    if (nowSec >= marketInfo.endTime) {
      if (pendingUpOrderId) {
        await cancelOrder(pendingUpOrderId);
        pendingUpOrderId = null;
      }
      if (pendingDownOrderId) {
        await cancelOrder(pendingDownOrderId);
        pendingDownOrderId = null;
      }
      if (positionUp) {
        const bid = priceStream.getBestBid(upTokenId);
        const mid = priceStream.getMid(upTokenId);
        const sellPrice = bid ?? mid ?? positionUp.entryPrice * 0.95;
        const toSell = Math.floor((positionUp.remainingShares - 0.01) * 100) / 100;
        if (toSell > 0) {
          const res = await marketSell(positionUp.tokenId, toSell, sellPrice);
          if (res.ok) log(`[SELL] flatten_past_end Up shares=${toSell}`);
        }
        positionUp = null;
      }
      if (positionDown) {
        const bid = priceStream.getBestBid(downTokenId);
        const mid = priceStream.getMid(downTokenId);
        const sellPrice = bid ?? mid ?? positionDown.entryPrice * 0.95;
        const toSell = Math.floor((positionDown.remainingShares - 0.01) * 100) / 100;
        if (toSell > 0) {
          const res = await marketSell(positionDown.tokenId, toSell, sellPrice);
          if (res.ok) log(`[SELL] flatten_past_end Down shares=${toSell}`);
        }
        positionDown = null;
      }
      ordersPlacedThisMarket = false;

      // Auto-redeem when market resolved
      if (config.AUTO_REDEEM && !redeemAttemptedConditionIds.has(marketInfo.conditionId)) {
        redeemAttemptedConditionIds.add(marketInfo.conditionId);
        try {
          const resolution = await checkConditionResolution(marketInfo.conditionId);
          if (resolution.isResolved) {
            await redeemMarket(marketInfo.conditionId);
            log(`[REDEEM] redeemed conditionId=${marketInfo.conditionId.slice(0, 18)}…`);
          }
        } catch (e) {
          logErr(`[REDEEM] skip or failed for ${marketInfo.conditionId.slice(0, 18)}…`, e);
        }
      }
      return;
    }

    // Detect fills from pending limit orders
    if (pendingUpOrderId) {
      const order = await getOrder(pendingUpOrderId);
      if (!order) {
        pendingUpOrderId = null;
      } else {
        const matched = parseClobSize(order.size_matched);
        const status = (order.status || "").toLowerCase();
        if (status === "matched" || matched > 0) {
          const shares = Math.max(0.01, Math.floor(matched * 100) / 100);
          positionUp = {
            conditionId: marketInfo.conditionId,
            tokenId: upTokenId,
            outcome: "Up",
            entryPrice: config.BUY_LIMIT_PRICE,
            shares,
            remainingShares: shares,
            entryTimeSec: nowSec,
          };
          log(`[BUY] Up filled shares=${shares.toFixed(2)} @ ${config.BUY_LIMIT_PRICE}`);
          pendingUpOrderId = null;
        }
      }
    }
    if (pendingDownOrderId) {
      const order = await getOrder(pendingDownOrderId);
      if (!order) {
        pendingDownOrderId = null;
      } else {
        const matched = parseClobSize(order.size_matched);
        const status = (order.status || "").toLowerCase();
        if (status === "matched" || matched > 0) {
          const shares = Math.max(0.01, Math.floor(matched * 100) / 100);
          positionDown = {
            conditionId: marketInfo.conditionId,
            tokenId: downTokenId,
            outcome: "Down",
            entryPrice: config.BUY_LIMIT_PRICE,
            shares,
            remainingShares: shares,
            entryTimeSec: nowSec,
          };
          log(`[BUY] Down filled shares=${shares.toFixed(2)} @ ${config.BUY_LIMIT_PRICE}`);
          pendingDownOrderId = null;
        }
      }
    }

    // Sell if price < 0.15 (stop-loss)
    if (positionUp) {
      const mid = priceStream.getMid(upTokenId);
      if (mid != null && mid < config.SELL_IF_BELOW) {
        positionUp.remainingShares = Math.floor(positionUp.remainingShares * 100) / 100;
        const toSell = Math.max(0, Math.floor((positionUp.remainingShares - 0.01) * 100) / 100);
        if (toSell > 0) {
          const ref = priceStream.getBestBid(upTokenId) ?? mid;
          const price = Math.max(parseFloat(config.TICK_SIZE), ref - config.SELL_LAG);
          const res = await marketSell(upTokenId, toSell, price);
          if (res.ok) {
            log(`[SELL] Up stop-loss (mid < ${config.SELL_IF_BELOW}) shares=${toSell.toFixed(2)}`);
            positionUp = null;
          }
        }
      }
    }
    if (positionDown) {
      const mid = priceStream.getMid(downTokenId);
      if (mid != null && mid < config.SELL_IF_BELOW) {
        positionDown.remainingShares = Math.floor(positionDown.remainingShares * 100) / 100;
        const toSell = Math.max(0, Math.floor((positionDown.remainingShares - 0.01) * 100) / 100);
        if (toSell > 0) {
          const ref = priceStream.getBestBid(downTokenId) ?? mid;
          const price = Math.max(parseFloat(config.TICK_SIZE), ref - config.SELL_LAG);
          const res = await marketSell(downTokenId, toSell, price);
          if (res.ok) {
            log(`[SELL] Down stop-loss (mid < ${config.SELL_IF_BELOW}) shares=${toSell.toFixed(2)}`);
            positionDown = null;
          }
        }
      }
    }

    // Place each token once between market open and first BUY_WINDOW_SEC (e.g. 1 minute)
    const elapsedSec = nowSec - marketInfo.startTime;
    const inBuyWindow = elapsedSec >= 0 && elapsedSec < config.BUY_WINDOW_SEC;
    if (inBuyWindow && !upOrderAttemptedThisMarket && !pendingUpOrderId) {
      upOrderAttemptedThisMarket = true;
      const upRes = await limitBuyGTC(upTokenId, config.BUY_AMOUNT_USD, config.BUY_LIMIT_PRICE);
      if (upRes.ok && upRes.orderId) pendingUpOrderId = upRes.orderId;
      if (upRes.ok) log(`[BUY] placed GTC limit buy Up @ ${config.BUY_LIMIT_PRICE} amountUsd=${config.BUY_AMOUNT_USD} (elapsed=${elapsedSec}s)`);
    }
    if (inBuyWindow && !downOrderAttemptedThisMarket && !pendingDownOrderId) {
      downOrderAttemptedThisMarket = true;
      const downRes = await limitBuyGTC(downTokenId, config.BUY_AMOUNT_USD, config.BUY_LIMIT_PRICE);
      if (downRes.ok && downRes.orderId) pendingDownOrderId = downRes.orderId;
      if (downRes.ok) log(`[BUY] placed GTC limit buy Down @ ${config.BUY_LIMIT_PRICE} amountUsd=${config.BUY_AMOUNT_USD} (elapsed=${elapsedSec}s)`);
    }
    if (upOrderAttemptedThisMarket && downOrderAttemptedThisMarket) {
      ordersPlacedThisMarket = true;
    }
    if (!inBuyWindow && elapsedSec >= config.BUY_WINDOW_SEC) {
      ordersPlacedThisMarket = true;
    }
  };

  setInterval(() => {
    loop().catch((e) => logErr("Loop", e));
  }, loopMs);

  setInterval(async () => {
    if (!market) return;
    const slug = getSlugForCurrentWindow();
    if (slug === currentSlug) return;
    try {
      const m = await getCurrentMarket();
      if (!m || m.marketInfo.conditionId === market.marketInfo.conditionId) return;
      if (pendingUpOrderId) {
        await cancelOrder(pendingUpOrderId);
        pendingUpOrderId = null;
      }
      if (pendingDownOrderId) {
        await cancelOrder(pendingDownOrderId);
        pendingDownOrderId = null;
      }
      log(`[SWITCH] next market slug=${slug}`);
      subscribeToMarket(m);
    } catch (e) {
      logErr("Window check", e);
    }
  }, WINDOW_CHECK_MS);

  process.on("SIGINT", () => {
    priceStream.shutdown();
    process.exit(0);
  });
}

main().catch((e) => {
  logErr("Fatal", e);
  process.exit(1);
});
