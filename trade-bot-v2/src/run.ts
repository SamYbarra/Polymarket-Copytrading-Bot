/**
 * Trade bot v2: speed-first, parallel, executor + realtime market price layer.
 * Market switch: same as origin (src/scripts/monitor-token-price-ws.ts) — slug-based check every 5s.
 */

import { AssetType } from "@polymarket/clob-client";
import { config } from "./config";
import { MarketPriceStream } from "./price/market-price-stream";
import { getCurrentMarket, getCurrentWindowTs, getSlugForCurrentWindow } from "./data/market-data";
import { connectRedis, getRealtimeFeatures, isRedisConfigured } from "./data/redis-features";
import { marketBuy, marketSell, limitSell, cancelOrder, getClobClient } from "./executor/market-executor";
import { runApprove } from "./security/allowance";
import { createCredential } from "./security/createCredential";
import { shouldBuy } from "./strategy/decision";
import { predictFromFeatures, type MarketFeatures } from "./strategy/ml-prediction";
import { evaluateProfitLock } from "./strategy/profit-lock";
import { PriceVelocitySampler } from "./risk/btc-velocity";
import { evaluateVelocityGuard } from "./risk/velocity-guard";
import { getBtcPriceUsd } from "./price/btc-price";
import { getEthPriceUsd } from "./price/eth-price";
import type { MarketInfo, PositionState } from "./types";
import { logSell, logBuy } from "./log-trades";

const ts = () => new Date().toISOString();
const log = (msg: string) => console.log(`${ts()} ${msg}`);
const logErr = (msg: string, e?: unknown) => {
  console.error(`${ts()} ${msg}`);
  if (e != null) console.error(e);
};

async function main(): Promise<void> {
  log("Trade bot v2 starting (speed-first, market orders only)");

  if (config.ENABLE_TRADING && config.PRIVATE_KEY) {
    try {
      await createCredential();
      const clob = getClobClient();
      log("Auto-approve on startup…");
      await runApprove(clob);
      try {
        const res = await clob.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        const parseCol = (v: string | undefined) => {
          const s = (v ?? "").trim();
          const n = parseFloat(s) || 0;
          return s.includes(".") ? n : n / 1e6;
        };
        const balUsd = parseCol(res?.balance);
        const allowUsd = parseCol(res?.allowance);
        const allowStr = allowUsd >= 1e20 ? "max" : allowUsd.toFixed(2);
        log(`After approve: balance $${balUsd.toFixed(2)}, allowance $${allowStr}`);
      } catch {
        // CLOB may return 0 for proxy; on-chain already approved
      }
      log("Trading ready (credential + allowances)");
    } catch (e) {
      logErr("Trading init failed", e);
    }
  }

  const priceStream = new MarketPriceStream();
  let market: { marketInfo: MarketInfo; upTokenId: string; downTokenId: string } | null = null;
  let currentSlug: string | null = null;
  let position: PositionState | null = null;
  let boughtThisWindow = false;
  let buyPending = false;

  const velocitySampler = config.VELOCITY_ENABLED
    ? new PriceVelocitySampler({
        getPriceUsd: config.VELOCITY_ASSET === "eth" ? getEthPriceUsd : getBtcPriceUsd,
        assetLabel: config.VELOCITY_ASSET,
      })
    : null;
  if (velocitySampler) {
    velocitySampler.start();
    log(`${config.VELOCITY_ASSET.toUpperCase()} velocity risk layer enabled`);
  }

  const subscribeToMarket = (m: { marketInfo: MarketInfo; upTokenId: string; downTokenId: string }) => {
    market = m;
    currentSlug = getSlugForCurrentWindow();
    boughtThisWindow = false;
    buyPending = false;
    // Do not clear position here; stale position is handled in loop (sell previous-market token then clear)
    const windowStartSec = getCurrentWindowTs();
    const endTimeSec = windowStartSec + config.WINDOW_SEC;
    log(`[SWITCH] subscribe slug=${currentSlug} conditionId=${m.marketInfo.conditionId.slice(0, 18)}… (WS: close old, open new with tokens)`);
    priceStream.subscribe([m.upTokenId, m.downTokenId], {
      marketEndTimeSec: endTimeSec,
      onMarketClosed: async () => {
        const next = await getCurrentMarket();
        if (!next) return null;
        if (next.marketInfo.conditionId === market!.marketInfo.conditionId) return null;
        const nextSlug = getSlugForCurrentWindow();
        log(`[SWITCH] found next market slug=${nextSlug} conditionId=${next.marketInfo.conditionId.slice(0, 18)}… (unsub old WS, sub new)`);
        market = next;
        currentSlug = nextSlug;
        boughtThisWindow = false;
        buyPending = false;
        // Keep position so loop can try to flatten previous-market token once
        const nextEndSec = getCurrentWindowTs() + config.WINDOW_SEC;
        log(`[SWITCH] switched (onMarketClosed) to ${next.marketInfo.conditionId.slice(0, 18)}…`);
        return {
          tokenIds: [next.upTokenId, next.downTokenId],
          marketEndTimeSec: nextEndSec,
        };
      },
    });
  };

  /** Initial discovery only. After that, periodic window check (every 5s) switches by slug, same as origin. */
  const refreshMarket = async (): Promise<void> => {
    try {
      const m = await getCurrentMarket();
      if (!m) {
        log(`[SWITCH] refreshMarket: getCurrentMarket returned null`);
        return;
      }
      if (!market) {
        log(`[SWITCH] refreshMarket: discovered market, subscribing`);
        subscribeToMarket(m);
      }
    } catch (e) {
      logErr("Market refresh", e);
    }
  };

  if (isRedisConfigured()) {
    const ok = await connectRedis();
    if (ok) log("Redis connected (ML features from collector)");
    else logErr("Redis connect failed; buy will use price-only confidence");
  }

  await refreshMarket();
  if (market) {
    await priceStream.whenReady();
    log("Price stream ready");
  } else {
    log(`No current market yet (slug=${getSlugForCurrentWindow()}); loop will retry every 10s. Check MARKET_SLUG_PREFIX=btc-updown-5m- and MARKET_WINDOW_MINUTES=5 in .env`);
  }

  const loopMs = config.LOOP_MS;
  let lastMarketRefresh = 0;
  let lastElapsedSkipLog = 0;
  const WINDOW_CHECK_MS = 5000;
  /** Only one flatten_past_end attempt in flight to avoid CLOB spam. */
  let flattenPastEndInProgress = false;
  /** Underlying (BTC/ETH) price when we first see this market; used for reversal check before collapse/flatten. */
  let marketOpenPrice: number | null = null;
  let lastOpenPriceConditionId: string | null = null;

  const loop = async (): Promise<void> => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    if (!market && now - lastMarketRefresh > 10_000) {
      lastMarketRefresh = now;
      refreshMarket().catch((e) => logErr("Market refresh", e));
    }

    if (!market) return;

    const { marketInfo, upTokenId, downTokenId } = market;

    /** Stale position from previous market (we switched, position.conditionId !== current market). Try to sell once then clear. */
    /** Record underlying price when we first see this market (for reversal check before collapse/flatten). */
    if (market && (lastOpenPriceConditionId === null || lastOpenPriceConditionId !== market.marketInfo.conditionId)) {
      lastOpenPriceConditionId = market.marketInfo.conditionId;
      marketOpenPrice = velocitySampler?.getLastPrice() ?? null;
    }

    if (position && position.conditionId !== marketInfo.conditionId) {
      const tokenId = position.tokenId;
      const toSell = Math.floor((position.remainingShares - 0.01) * 100) / 100;
      if (toSell > 0) {
        const sellPrice = position.entryPrice * 0.95;
        const res =
          config.SELL_ORDER_TYPE === "limit"
            ? await limitSell(tokenId, toSell, sellPrice)
            : await marketSell(tokenId, toSell, sellPrice);
        if (res.ok) {
          const filled = "filledShares" in res ? res.filledShares : toSell;
          log(
            `[SELL] executed type=flatten_after_switch ${config.SELL_ORDER_TYPE} shares=${filled ?? toSell} price=${sellPrice.toFixed(3)} tokenId=${tokenId.slice(0, 18)}…`
          );
          const btc = velocitySampler?.getLastPrice();
          logSell({
            ts: ts(),
            condition: "flatten_after_switch",
            reason: "position from previous market, switched to new market",
            orderType: config.SELL_ORDER_TYPE as "market" | "limit",
            tokenId,
            outcome: position.outcome,
            sharesSold: toSell,
            price: sellPrice,
            filledShares: filled ?? toSell,
            position: {
              conditionId: position.conditionId,
              entryPrice: position.entryPrice,
              entryTimeSec: position.entryTimeSec,
              sharesBefore: position.remainingShares,
              remainingAfter: position.remainingShares - (filled ?? toSell),
              highWaterMark: position.highWaterMark,
              t1Hit: position.t1Hit,
              t2Hit: position.t2Hit,
            },
            market: { startTime: marketInfo.startTime, endTime: marketInfo.endTime },
            velocity: velocitySampler
              ? {
                  asset: config.VELOCITY_ASSET,
                  lastPrice: velocitySampler.getLastPrice(),
                  velocityAbs: velocitySampler.getVelocity(),
                  velocitySigned: velocitySampler.getVelocitySigned(),
                }
              : undefined,
          }).catch((e) => logErr("logSell", e));
        } else {
          logErr(
            `[SELL] failed type=flatten_after_switch shares=${toSell} price=${sellPrice.toFixed(3)} (redeem may be needed)`,
            (res as { error?: string }).error
          );
        }
      }
      position = null;
      return;
    }

    if (nowSec >= marketInfo.endTime) {
      if (position && !flattenPastEndInProgress) {
        flattenPastEndInProgress = true;
        const tokenId = position.outcome === "Up" ? upTokenId : downTokenId;
        const bid = priceStream.getBestBid(tokenId);
        const mid = priceStream.getMid(tokenId);
        const sellPrice = bid ?? mid ?? position.entryPrice * 0.95;
        try {
          if (position.limitOrderId) {
            const cancelRes = await cancelOrder(position.limitOrderId);
            if (cancelRes.ok) log(`[CANCEL] limit order ${position.limitOrderId.slice(0, 18)}… (past end time)`);
            position.limitOrderId = undefined;
          }
          const toSell = Math.floor((position.remainingShares - 0.01) * 100) / 100;
          if (toSell > 0) {
            const res =
              config.SELL_ORDER_TYPE === "limit"
                ? await limitSell(tokenId, toSell, sellPrice)
                : await marketSell(tokenId, toSell, sellPrice);
            if (res.ok) {
              const filled = "filledShares" in res ? res.filledShares : toSell;
              const remainingAfter = Math.floor((position.remainingShares - (filled ?? toSell)) * 100) / 100;
              position.remainingShares -= filled ?? toSell;
              position.remainingShares = Math.floor(position.remainingShares * 100) / 100;
              log(
                `[SELL] executed type=flatten_past_end ${config.SELL_ORDER_TYPE} shares=${(filled ?? toSell)} price=${sellPrice.toFixed(3)} reason=past endTime tokenId=${tokenId.slice(0, 18)}…`
              );
              logSell({
                ts: ts(),
                condition: "flatten_past_end",
                reason: "past endTime",
                orderType: config.SELL_ORDER_TYPE as "market" | "limit",
                tokenId,
                outcome: position.outcome,
                sharesSold: toSell,
                price: sellPrice,
                filledShares: filled ?? toSell,
                position: {
                  conditionId: position.conditionId,
                  entryPrice: position.entryPrice,
                  entryTimeSec: position.entryTimeSec,
                  sharesBefore: position.remainingShares + (filled ?? toSell),
                  remainingAfter,
                  highWaterMark: position.highWaterMark,
                  t1Hit: position.t1Hit,
                  t2Hit: position.t2Hit,
                },
                market: { startTime: marketInfo.startTime, endTime: marketInfo.endTime },
                velocity: velocitySampler
                  ? {
                      asset: config.VELOCITY_ASSET,
                      lastPrice: velocitySampler.getLastPrice(),
                      velocityAbs: velocitySampler.getVelocity(),
                      velocitySigned: velocitySampler.getVelocitySigned(),
                    }
                  : undefined,
              }).catch((e) => logErr("logSell", e));
            } else {
              logErr(`[SELL] failed type=flatten_past_end ${config.SELL_ORDER_TYPE} shares=${toSell} price=${sellPrice.toFixed(3)} reason=past endTime (redeem may be needed)`, (res as { error?: string }).error);
            }
          }
        } finally {
          flattenPastEndInProgress = false;
          position = null;
        }
      }
      return;
    }

    const upAsk = priceStream.getBestAsk(upTokenId);
    const downAsk = priceStream.getBestAsk(downTokenId);
    const upMid = priceStream.getMid(upTokenId);
    const downMid = priceStream.getMid(downTokenId);

    if (position) {
      const tokenId = position.outcome === "Up" ? upTokenId : downTokenId;
      const mid = position.outcome === "Up" ? upMid : downMid;
      if (mid != null && mid > position.highWaterMark) position.highWaterMark = mid;

      const velocityAbs = velocitySampler?.getVelocity() ?? null;
      const velocitySigned = velocitySampler?.getVelocitySigned() ?? null;
      const leftTimeSec = Math.max(0, marketInfo.endTime - nowSec);
      const guard = evaluateVelocityGuard({
        velocityAbs,
        velocitySigned,
        outcome: position.outcome,
        leftTimeSec,
      });
      const velocityAdverse =
        velocitySigned != null
          ? position.outcome === "Up"
            ? velocitySigned < 0
            : velocitySigned > 0
          : undefined;
      const signal = evaluateProfitLock(
        position,
        mid ?? position.entryPrice,
        nowSec,
        marketInfo.startTime,
        guard.tightenProfitLock,
        velocityAdverse,
        { leftTimeSec, velocitySigned }
      );
      if (signal.type !== "none" && signal.type !== "buy") {
        /** Before collapse or flatten: if velocity×leftTime > (currentPrice − marketOpenPrice), expect reversal → don't sell. */
        let shouldSell = true;
        if (
          (signal.type === "collapse" || signal.type === "flatten") &&
          velocitySigned != null &&
          leftTimeSec != null &&
          leftTimeSec > 0
        ) {
          const currentPrice = velocitySampler?.getLastPrice();
          if (currentPrice != null && marketOpenPrice != null && Number.isFinite(marketOpenPrice)) {
            const projectedMove = velocitySigned * leftTimeSec;
            const moveSinceOpen = currentPrice - marketOpenPrice;
            if (projectedMove > moveSinceOpen) {
              shouldSell = false;
              log(
                `[SELL] skip: reversal expected (velocity*leftTime=${projectedMove.toFixed(0)} > moveSinceOpen=${moveSinceOpen.toFixed(0)}), not ${signal.type}`
              );
            }
          }
        }
        if (shouldSell) {
          /** Cancel resting limit order so shares are available; avoid "not enough balance" from locked size. */
          if (position.limitOrderId) {
            const cancelRes = await cancelOrder(position.limitOrderId);
            if (cancelRes.ok) log(`[CANCEL] limit order ${position.limitOrderId.slice(0, 18)}… (before profit-lock sell)`);
            position.limitOrderId = undefined;
          }
          /** Normalize to 2 decimals to avoid float drift; treat dust as 0. */
          position.remainingShares = Math.floor(position.remainingShares * 100) / 100;
          if (position.remainingShares < 0.01) {
            position = null;
            return;
          }
          let sellShares = 0;
          if (signal.type === "sell_partial_t1" && signal.sizeRatio != null) {
            sellShares = Math.floor(position.shares * signal.sizeRatio * 100) / 100;
            position.t1Hit = true;
          } else if (signal.type === "sell_partial_t2" && signal.sizeRatio != null) {
            sellShares = Math.floor(position.shares * signal.sizeRatio * 100) / 100;
            position.t2Hit = true;
          } else if (signal.type === "collapse" && signal.sizeRatio != null) {
            sellShares = Math.floor(position.remainingShares * signal.sizeRatio * 100) / 100;
          } else {
            /** Flatten: use (remaining - 0.01) floored to 2 decimals so we never exceed balance due to precision. */
            sellShares = Math.max(0, Math.floor((position.remainingShares - 0.01) * 100) / 100);
          }
          /** Cap at 2 decimals so we never request more than available. */
          const cap = Math.max(0, Math.floor((position.remainingShares - 0.01) * 100) / 100);
          const toSell = Math.min(sellShares, cap);
          if (toSell > 0) {
            /** Collapse + Down: sell at bestBid - 0.02 for lag (limit below bid to fill faster when price is dropping). */
            let price: number;
            if (signal.type === "collapse" && position.outcome === "Down") {
              const bid = priceStream.getBestBid(tokenId);
              price = bid != null ? Math.max(0.01, bid - 0.02) : position.entryPrice;
            } else {
              price = priceStream.getBestAsk(tokenId) ?? position.entryPrice;
            }
            const res =
              config.SELL_ORDER_TYPE === "limit"
                ? await limitSell(tokenId, toSell, price)
                : await marketSell(tokenId, toSell, price);
            if (res.ok) {
              const filled = "filledShares" in res ? res.filledShares : toSell;
              const sharesBefore = position.remainingShares;
              position.remainingShares -= filled ?? toSell;
              position.remainingShares = Math.floor(position.remainingShares * 100) / 100;
              const btc = velocitySampler?.getLastPrice();
              const b = btc != null ? btc.toFixed(2) : "—";
              log(
                `[SELL] executed type=${signal.type} ${config.SELL_ORDER_TYPE} shares=${(filled ?? toSell)?.toFixed(2) ?? ""} price=${price.toFixed(3)} ${velocitySampler?.getAssetLabel() ?? config.VELOCITY_ASSET}=${b} reason=${signal.reason ?? ""} tokenId=${tokenId.slice(0, 18)}…`
              );
              const leftTimeSec = Math.max(0, marketInfo.endTime - nowSec);
              logSell({
                ts: ts(),
                condition: signal.type,
                reason: signal.reason ?? "",
                orderType: config.SELL_ORDER_TYPE as "market" | "limit",
                tokenId,
                outcome: position.outcome,
                sharesSold: toSell,
                price,
                filledShares: filled ?? toSell,
                position: {
                  conditionId: position.conditionId,
                  entryPrice: position.entryPrice,
                  entryTimeSec: position.entryTimeSec,
                  sharesBefore,
                  remainingAfter: position.remainingShares,
                  highWaterMark: position.highWaterMark,
                  t1Hit: position.t1Hit,
                  t2Hit: position.t2Hit,
                },
                market: { startTime: marketInfo.startTime, endTime: marketInfo.endTime, leftTimeSec },
                velocity: velocitySampler
                  ? {
                      asset: config.VELOCITY_ASSET,
                      lastPrice: velocitySampler.getLastPrice(),
                      velocityAbs: velocitySampler.getVelocity(),
                      velocitySigned: velocitySampler.getVelocitySigned(),
                    }
                  : undefined,
                signal: { type: signal.type, sizeRatio: signal.sizeRatio },
              }).catch((e) => logErr("logSell", e));
            } else {
              const btc = velocitySampler?.getLastPrice();
              const b = btc != null ? btc.toFixed(2) : "—";
              logErr(
                `[SELL] failed type=${signal.type} ${config.SELL_ORDER_TYPE} shares=${toSell} price=${price.toFixed(3)} ${velocitySampler?.getAssetLabel() ?? config.VELOCITY_ASSET}=${b} reason=${signal.reason ?? ""}`,
                (res as { error?: string }).error
              );
            }
            if (position && position.remainingShares < 0.01) position = null;
          }
        }
      }
      return;
    }

    if (buyPending || boughtThisWindow) {
      return;
    }
    const elapsedSec = nowSec - marketInfo.startTime;
    if (elapsedSec < config.PREDICTION_MIN_ELAPSED_SEC) {
      if (now - lastElapsedSkipLog > 30_000) {
        lastElapsedSkipLog = now;
        log(
          `[BUY CHECK] skip: elapsed=${elapsedSec}s < min=${config.PREDICTION_MIN_ELAPSED_SEC}s (no predict before min)`
        );
      }
      return;
    }
    if (elapsedSec >= config.BUY_MAX_ELAPSED_SEC) {
      if (now - lastElapsedSkipLog > 30_000) {
        lastElapsedSkipLog = now;
        log(
          `[BUY CHECK] skip: elapsed=${elapsedSec}s >= max=${config.BUY_MAX_ELAPSED_SEC}s (no buy after ${config.BUY_MAX_ELAPSED_SEC / 60}min)`
        );
      }
      return;
    }
    if (upAsk == null && downAsk == null) {
      log(
        `[BUY CHECK] skip: no prices elapsed=${elapsedSec}s (min=${config.PREDICTION_MIN_ELAPSED_SEC}) upAsk=${upAsk ?? "null"} downAsk=${downAsk ?? "null"}`
      );
      return;
    }

    const inBand = (p: number) => p > config.BUY_PRICE_MIN && p < config.BUY_PRICE_MAX;
    let tokenId: string | null = null;
    let outcome: "Up" | "Down" = "Up";
    let bestAsk = 0;
    let confidence = 0;
    let skipReason: string | null = null;
    /** Which condition triggered the buy: ml_prediction, price_only, or chase. */
    let buyCondition: string = "price_only";

    const rawFeatures = await getRealtimeFeatures(marketInfo.conditionId);
    if (rawFeatures) {
      log(`[BUY CHECK] market features from Redis conditionId=${marketInfo.conditionId.slice(0, 18)}…`);
      try {
        const data = JSON.parse(rawFeatures) as { features?: MarketFeatures; timestamp?: number; conditionId?: string };
       // log(`[BUY CHECK] data=${JSON.stringify(data)}`);
        const features = data?.features;
        if (features && features.conditionId === marketInfo.conditionId) {
          const prediction = await predictFromFeatures(features);
          outcome = prediction.predictedOutcome;
          confidence = prediction.confidence;
          log(
            `[BUY CHECK] prediction from features elapsed=${elapsedSec}s upAsk=${upAsk?.toFixed(3) ?? "null"} downAsk=${downAsk?.toFixed(3) ?? "null"} outcome=${outcome} confidence=${(confidence * 100).toFixed(1)}% volRatio=${(features.volumeRatio * 100).toFixed(1)}% hotWallets=${features.hotWalletCountUp + features.hotWalletCountDown}`
          );
          const ask = outcome === "Up" ? (upAsk ?? null) : (downAsk ?? null);
          if (ask == null) {
            skipReason = `no ${outcome} price`;
          } else if (!inBand(ask)) {
            skipReason = `${outcome} ask=${ask.toFixed(3)} outside band (${config.BUY_PRICE_MIN}, ${config.BUY_PRICE_MAX})`;
          } else if (confidence < config.MIN_CONFIDENCE) {
            skipReason = `confidence ${(confidence * 100).toFixed(1)}% < min ${(config.MIN_CONFIDENCE * 100).toFixed(0)}%`;
          } else {
            tokenId = outcome === "Up" ? upTokenId : downTokenId;
            bestAsk = ask;
            buyCondition = "ml_prediction";
          }
        } else {
          skipReason = features ? "features.conditionId !== market" : "no features in payload";
        }
      } catch (e) {
        skipReason = `features parse/use failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      skipReason = "no Redis features (price-only fallback)";
    }

    if (!tokenId) {
      if (inBand(upAsk ?? 0) && (upAsk ?? 0) >= config.MIN_CONFIDENCE) {
        if (!inBand(downAsk ?? 0) || (upAsk ?? 0) >= (downAsk ?? 0)) {
          tokenId = upTokenId;
          outcome = "Up";
          bestAsk = upAsk!;
        }
      }
      if (!tokenId && inBand(downAsk ?? 0) && (downAsk ?? 0) >= config.MIN_CONFIDENCE) {
        tokenId = downTokenId;
        outcome = "Down";
        bestAsk = downAsk!;
      }
      /** When neither ask is in band, still pick a side (favorite = higher ask) so we have tokenId for chase / downstream. */
      if (!tokenId && upAsk != null && downAsk != null) {
        if (upAsk >= downAsk) {
          tokenId = upTokenId;
          outcome = "Up";
          bestAsk = upAsk;
        } else {
          tokenId = downTokenId;
          outcome = "Down";
          bestAsk = downAsk;
        }
      }
      const decision = shouldBuy(bestAsk, outcome);
      confidence = decision.confidence;
      if (!tokenId) {
        log(
          `[BUY CHECK] skip (price-only) elapsed=${elapsedSec}s upAsk=${upAsk?.toFixed(3) ?? "null"} downAsk=${downAsk?.toFixed(3) ?? "null"} band=(${config.BUY_PRICE_MIN},${config.BUY_PRICE_MAX}) inBand up=${inBand(upAsk ?? 0)} down=${inBand(downAsk ?? 0)} minConf=${(config.MIN_CONFIDENCE * 100).toFixed(0)}% → no tokenId${skipReason ? `; prior: ${skipReason}` : ""}`
        );
      }
    }
    if (skipReason && tokenId) {
      log(`[BUY CHECK] using price-only fallback (features skip: ${skipReason})`);
    }

    /** Get velocity to allow wider band / chase when strongly favorable (method 1 + 2). */
    const velocityAbs = velocitySampler?.getVelocity() ?? null;
    const velocitySigned = velocitySampler?.getVelocitySigned() ?? null;
    const velocityFavorable =
      outcome === "Up" ? (velocitySigned ?? 0) > 0 : (velocitySigned ?? 0) < 0;
    const velocityStrong =
      (velocityAbs ?? 0) >= config.VELOCITY_FAVORABLE_FOR_WIDER_BAND;
    const effectiveMax =
      velocityFavorable && velocityStrong
        ? config.BUY_PRICE_MAX_FAVORABLE
        : config.BUY_PRICE_MAX;
    const inBandEffective = (p: number) =>
      p > config.BUY_PRICE_MIN && p < effectiveMax;

    /** Chase (method 2): tokenId null because ask was above normal band; allow buy if ask in (MAX, effectiveMax] and velocity favorable+strong. */
    if (!tokenId && skipReason?.includes("outside band") && velocityFavorable && velocityStrong) {
      const chaseAsk = outcome === "Up" ? (upAsk ?? null) : (downAsk ?? null);
      if (
        chaseAsk != null &&
        chaseAsk > config.BUY_PRICE_MAX &&
        chaseAsk <= effectiveMax &&
        confidence >= config.MIN_CONFIDENCE
      ) {
        tokenId = outcome === "Up" ? upTokenId : downTokenId;
        bestAsk = chaseAsk;
        skipReason = null;
        buyCondition = "chase";
        log(
          `[BUY CHECK] chase: outcome=${outcome} bestAsk=${bestAsk.toFixed(3)} (above band, velocity ${velocityAbs?.toFixed(2)} $/s favorable)`
        );
      }
    }

    if (!tokenId) {
      if (skipReason) {
        log(
          `[BUY CHECK] skip: ${skipReason} elapsed=${elapsedSec}s upAsk=${upAsk?.toFixed(3) ?? "null"} downAsk=${downAsk?.toFixed(3) ?? "null"}`
        );
      }
      return;
    }

    const useWiderBandOrChase = bestAsk > config.BUY_PRICE_MAX;
    const buy =
      tokenId !== null &&
      confidence >= config.MIN_CONFIDENCE &&
      inBandEffective(bestAsk);
    if (!buy) {
      log(
        `[BUY CHECK] skip: buy=false elapsed=${elapsedSec}s outcome=${outcome} confidence=${(confidence * 100).toFixed(1)}% (min=${(config.MIN_CONFIDENCE * 100).toFixed(0)}%) bestAsk=${bestAsk.toFixed(3)} inBand=${inBandEffective(bestAsk)} band=(${config.BUY_PRICE_MIN},${effectiveMax})`
      );
      return;
    }

    const guard = evaluateVelocityGuard({
      velocityAbs,
      velocitySigned,
      outcome,
      leftTimeSec: undefined,
    });
    if (!guard.allowBuy) {
      const reason = config.VELOCITY_SKIP_BUY_ON_ANY_ADVERSE
        ? "velocity adverse to outcome (skip on any adverse)"
        : `velocityAbs >= ${config.VELOCITY_BLOCK_USD_PER_SEC} $/s (adverse for ${outcome})`;
      log(
        `[BUY CHECK] skip: velocity guard block elapsed=${elapsedSec}s outcome=${outcome} velocityAbs=${velocityAbs?.toFixed(2) ?? "null"} $/s — ${reason}`
      );
      return;
    }
    const amountUsd = useWiderBandOrChase
      ? config.BUY_AMOUNT_USD * config.BUY_AMOUNT_FAVORABLE_RATIO
      : guard.reduceSize
        ? config.BUY_AMOUNT_USD / 2
        : config.BUY_AMOUNT_USD;
    const buyShares = Math.max(0.01, Math.round((amountUsd / bestAsk) * 100) / 100);
    if (guard.reduceSize) {
      log(
        `[RISK] velocity ${velocityAbs?.toFixed(2)} $/s: reduced to $${amountUsd.toFixed(2)} (${buyShares.toFixed(2)} shares)`
      );
    }
    if (useWiderBandOrChase) {
      log(
        `[BUY CHECK] wider band/chase: bestAsk=${bestAsk.toFixed(3)} amountUsd=${amountUsd.toFixed(2)} (${(config.BUY_AMOUNT_FAVORABLE_RATIO * 100).toFixed(0)}% size)`
      );
    }

    log(
      `[BUY CHECK] all conditions passed elapsed=${elapsedSec}s → buying outcome=${outcome} bestAsk=${bestAsk.toFixed(3)} confidence=${(confidence * 100).toFixed(1)}% amountUsd=${amountUsd.toFixed(2)} shares=${buyShares.toFixed(2)}`
    );
    buyPending = true;
    try {
      log(`[BUY] sending market buy outcome=${outcome} shares=${buyShares.toFixed(2)} price=${bestAsk.toFixed(3)} amountUsd≈${amountUsd.toFixed(2)} tokenId=${tokenId.slice(0, 18)}…`);
  
      const res = await marketBuy(tokenId, buyShares, bestAsk, marketInfo);
      if (res.ok && res.filledShares) {
        boughtThisWindow = true;
        /** Cap to 2 decimals and 0.01 safety so we never overstate vs real balance (e.g. API 12 vs real 11.99). */
        const filledSafe = Math.max(0.01, Math.floor((res.filledShares - 0.01) * 100) / 100);
        position = {
          conditionId: marketInfo.conditionId,
          tokenId,
          outcome,
          entryPrice: bestAsk,
          confidence,
          shares: filledSafe,
          remainingShares: filledSafe,
          entryTimeSec: nowSec,
          t1Hit: false,
          t2Hit: false,
          highWaterMark: bestAsk,
        };
        const btc = velocitySampler?.getLastPrice();
        const b = btc != null ? btc.toFixed(2) : "—";
        log(
          `[BUY] executed outcome=${outcome} shares=${filledSafe.toFixed(2)} entryPrice=${bestAsk.toFixed(3)} ${velocitySampler?.getAssetLabel() ?? config.VELOCITY_ASSET}=${b} conf=${(confidence * 100).toFixed(1)}% tokenId=${tokenId.slice(0, 18)}…`
        );
        logBuy({
          ts: ts(),
          condition: buyCondition,
          outcome,
          tokenId,
          shares: filledSafe,
          entryPrice: bestAsk,
          amountUsd,
          confidence,
          velocity: velocitySampler
            ? {
                asset: config.VELOCITY_ASSET,
                lastPrice: velocitySampler.getLastPrice(),
                velocityAbs: velocitySampler.getVelocity(),
                velocitySigned: velocitySampler.getVelocitySigned(),
                favorable: velocityFavorable,
                reduceSize: guard.reduceSize,
              }
            : undefined,
          market: {
            conditionId: marketInfo.conditionId,
            startTime: marketInfo.startTime,
            endTime: marketInfo.endTime,
            elapsedSec,
          },
          band: {
            useWiderBandOrChase,
            buyPriceMin: config.BUY_PRICE_MIN,
            buyPriceMaxEffective: effectiveMax,
          },
        }).catch((e) => logErr("logBuy", e));
        const limitRes = await limitSell(tokenId, filledSafe, config.LIMIT_SELL_PRICE);
        if (limitRes.ok && limitRes.orderId) {
          position.limitOrderId = limitRes.orderId;
          log(
            `[SELL] limit order placed @ ${config.LIMIT_SELL_PRICE} for ${filledSafe.toFixed(2)} shares ${velocitySampler?.getAssetLabel() ?? config.VELOCITY_ASSET}=${b} (orderId=${limitRes.orderId.slice(0, 18)}…)`
          );
        } else {
          logErr(`[SELL] limit order @ ${config.LIMIT_SELL_PRICE} failed ${config.VELOCITY_ASSET}=${b}`, (limitRes as { error?: string }).error);
        }
      } else {
        logErr(
          `[BUY] failed outcome=${outcome} shares=${buyShares.toFixed(2)} price=${bestAsk.toFixed(3)}`,
          (res as { ok: boolean; error?: string }).error
        );
      }
    } finally {
      buyPending = false;
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
      if (!m) return;
      if (m.marketInfo.conditionId === market.marketInfo.conditionId) return;
      log(`[SWITCH] found next market slug=${slug} conditionId=${m.marketInfo.conditionId.slice(0, 18)}… (unsub old WS, sub new)`);
      subscribeToMarket(m);
    } catch (e) {
      logErr("Window check", e);
    }
  }, WINDOW_CHECK_MS);

  setInterval(() => {
    if (!market) return;
    const upMid = priceStream.getMid(market.upTokenId);
    const downMid = priceStream.getMid(market.downTokenId);
    const btc = velocitySampler?.getLastPrice();
    const vel = velocitySampler?.getVelocity();
    const UM = upMid != null ? upMid.toFixed(3) : "—";
    const DM = downMid != null ? downMid.toFixed(3) : "—";
    const pr = btc != null ? btc.toFixed(2) : "—";
    const velStr = vel != null ? vel.toFixed(2) : "—";
    const a1 = config.ALPHA1.toFixed(2);
    const a2 = config.ALPHA2.toFixed(2);
    const col = config.COLLAPSE_THRESHOLD.toFixed(2);
    const flat = config.FLATTEN_BY_MIN.toFixed(1);
    const tMin = config.TRAIL_MIN.toFixed(3);
    const tMax = config.TRAIL_MAX.toFixed(2);
    const soon = config.RESOLUTION_SOON_SEC;
    log(
      `[MARKET] UM=${UM} DM=${DM} pr=${pr} vel=${velStr} | PL: a1=${a1} a2=${a2} r1=${config.R1} r2=${config.R2} col=${col} flat=${flat}m tMin=${tMin} tMax=${tMax} soon=${soon}s`
    );
  }, 1000);

  process.on("SIGINT", () => {
    velocitySampler?.stop();
    priceStream.shutdown();
    process.exit(0);
  });
}

main().catch((e) => {
  logErr("Fatal", e);
  process.exit(1);
});
