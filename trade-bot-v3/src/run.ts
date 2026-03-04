/**
 * Trade bot v3: 0.35 strategy.
 * - Buy: GTD limit buy on target side at 0.35 (lifetime 2 min 30 s).
 * - Sell: 50% when mid >= 0.4, 50% when mid >= 0.5.
 */

import { config } from "./config";
import { MarketPriceStream } from "./price/market-price-stream";
import { getCurrentMarket, getCurrentWindowTs, getSlugForCurrentWindow } from "./data/market-data";
import { limitBuyGTD, getOrder, marketSell, cancelOrder, getClobClient } from "./executor/market-executor";
import { runApprove } from "./security/allowance";
import { createCredential } from "./security/createCredential";
import type { MarketInfo, PositionState } from "./types";

const ts = () => new Date().toISOString();
const log = (msg: string) => console.log(`${ts()} ${msg}`);
const logErr = (msg: string, e?: unknown) => {
  console.error(`${ts()} ${msg}`);
  if (e != null) console.error(e);
};

async function main(): Promise<void> {
  log("Trade bot v3 starting (0.35 strategy: GTD buy 2.5min, sell 50% @ 0.4 / 50% @ 0.5)");

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
  let position: PositionState | null = null;
  /** When we have a live GTD buy order, track it so we can detect fill or expiry. */
  let pendingGtdOrderId: string | null = null;
  let pendingGtdTokenId: string | null = null;
  let pendingGtdOutcome: "Up" | "Down" | null = null;

  const subscribeToMarket = (m: { marketInfo: MarketInfo; upTokenId: string; downTokenId: string }) => {
    market = m;
    currentSlug = getSlugForCurrentWindow();
    pendingGtdOrderId = null;
    pendingGtdTokenId = null;
    pendingGtdOutcome = null;
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
        pendingGtdOrderId = null;
        pendingGtdTokenId = null;
        pendingGtdOutcome = null;
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

    // Stale position from previous market
    if (position && position.conditionId !== marketInfo.conditionId) {
      const tokenId = position.tokenId;
      const toSell = Math.floor((position.remainingShares - 0.01) * 100) / 100;
      if (toSell > 0) {
        const sellPrice = position.entryPrice * 0.95;
        const res = await marketSell(tokenId, toSell, sellPrice);
        if (res.ok) {
          log(`[SELL] flatten_after_switch shares=${toSell} price=${sellPrice.toFixed(3)}`);
        } else {
          logErr(`[SELL] failed flatten_after_switch shares=${toSell}`);
        }
      }
      position = null;
      return;
    }

    // Past market end: flatten and clear
    if (nowSec >= marketInfo.endTime) {
      if (position) {
        const tokenId = position.outcome === "Up" ? upTokenId : downTokenId;
        const bid = priceStream.getBestBid(tokenId);
        const mid = priceStream.getMid(tokenId);
        const sellPrice = bid ?? mid ?? position.entryPrice * 0.95;
        const toSell = Math.floor((position.remainingShares - 0.01) * 100) / 100;
        if (toSell > 0) {
          const res = await marketSell(tokenId, toSell, sellPrice);
          if (res.ok) log(`[SELL] flatten_past_end shares=${toSell} price=${sellPrice.toFixed(3)}`);
        }
        position = null;
      }
      pendingGtdOrderId = null;
      pendingGtdTokenId = null;
      pendingGtdOutcome = null;
      return;
    }

    // We have a position: sell 50% at 0.4, 50% at 0.5
    if (position) {
      const tokenId = position.outcome === "Up" ? upTokenId : downTokenId;
      const mid = priceStream.getMid(tokenId) ?? position.entryPrice;
      position.remainingShares = Math.floor(position.remainingShares * 100) / 100;
      if (position.remainingShares < 0.01) {
        position = null;
        return;
      }

      if (!position.t1Hit && mid >= config.SELL_T1_PRICE) {
        const sellShares = Math.floor(position.shares * config.SELL_T1_RATIO * 100) / 100;
        const toSell = Math.min(sellShares, Math.max(0, position.remainingShares - 0.01));
        if (toSell > 0) {
          const price = priceStream.getBestBid(tokenId) ?? mid;
          const res = await marketSell(tokenId, toSell, price);
          if (res.ok) {
            const filled = res.filledShares ?? toSell;
            position.remainingShares -= filled;
            position.remainingShares = Math.floor(position.remainingShares * 100) / 100;
            position.t1Hit = true;
            log(`[SELL] T1 (50% @ 0.4) shares=${filled.toFixed(2)} price=${price.toFixed(3)}`);
          }
        }
        return;
      }

      if (position.t1Hit && !position.t2Hit && mid >= config.SELL_T2_PRICE) {
        const toSell = Math.floor((position.remainingShares - 0.01) * 100) / 100;
        if (toSell > 0) {
          const price = priceStream.getBestBid(tokenId) ?? mid;
          const res = await marketSell(tokenId, toSell, price);
          if (res.ok) {
            const filled = res.filledShares ?? toSell;
            position.remainingShares -= filled;
            position.t2Hit = true;
            log(`[SELL] T2 (50% @ 0.5) shares=${filled.toFixed(2)} price=${price.toFixed(3)}`);
            position = null;
          }
        }
        return;
      }
      return;
    }

    // No position: manage GTD buy or detect fill
    if (pendingGtdOrderId && pendingGtdTokenId && pendingGtdOutcome) {
      const order = await getOrder(pendingGtdOrderId);
      if (!order) {
        log("[GTD] order not found (expired/cancelled), will place new next loop");
        pendingGtdOrderId = null;
        pendingGtdTokenId = null;
        pendingGtdOutcome = null;
        return;
      }
      const matched = parseFloat(order.size_matched || "0");
      const status = (order.status || "").toLowerCase();
      if (status === "matched" || matched > 0) {
        const shares = Math.max(0.01, Math.floor(matched * 100) / 100);
        position = {
          conditionId: marketInfo.conditionId,
          tokenId: pendingGtdTokenId,
          outcome: pendingGtdOutcome,
          entryPrice: config.BUY_TARGET_PRICE,
          shares,
          remainingShares: shares,
          entryTimeSec: nowSec,
          t1Hit: false,
          t2Hit: false,
        };
        log(`[BUY] GTD filled outcome=${pendingGtdOutcome} shares=${shares.toFixed(2)} @ ${config.BUY_TARGET_PRICE}`);
        pendingGtdOrderId = null;
        pendingGtdTokenId = null;
        pendingGtdOutcome = null;
      }
      return;
    }

    // No position, no pending GTD: place new GTD limit buy at 0.35 on target side
    const upAsk = priceStream.getBestAsk(upTokenId);
    const downAsk = priceStream.getBestAsk(downTokenId);
    let tokenId: string | null = null;
    let outcome: "Up" | "Down" = "Up";
    const target = config.TARGET_OUTCOME;
    if (target === "up") {
      tokenId = upTokenId;
      outcome = "Up";
    } else if (target === "down") {
      tokenId = downTokenId;
      outcome = "Down";
    } else {
      if (upAsk != null && downAsk != null) {
        if (upAsk <= downAsk) {
          tokenId = upTokenId;
          outcome = "Up";
        } else {
          tokenId = downTokenId;
          outcome = "Down";
        }
      } else if (upAsk != null) {
        tokenId = upTokenId;
        outcome = "Up";
      } else if (downAsk != null) {
        tokenId = downTokenId;
        outcome = "Down";
      }
    }
    if (!tokenId) {
      return;
    }
    const res = await limitBuyGTD(tokenId, config.BUY_AMOUNT_USD, config.BUY_TARGET_PRICE);
    if (res.ok && res.orderId) {
      pendingGtdOrderId = res.orderId;
      pendingGtdTokenId = tokenId;
      pendingGtdOutcome = outcome;
      const expSec = config.GTD_BUFFER_SEC + config.GTD_LIFETIME_SEC;
      log(`[GTD] placed limit buy outcome=${outcome} @ ${config.BUY_TARGET_PRICE} amountUsd=${config.BUY_AMOUNT_USD} expires in ${expSec}s orderId=${res.orderId.slice(0, 18)}…`);
    } else {
      logErr("[GTD] place failed", (res as { error?: string }).error);
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
      if (pendingGtdOrderId) {
        await cancelOrder(pendingGtdOrderId);
        pendingGtdOrderId = null;
        pendingGtdTokenId = null;
        pendingGtdOutcome = null;
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
