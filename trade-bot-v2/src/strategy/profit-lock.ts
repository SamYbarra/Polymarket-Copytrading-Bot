/**
 * Profit lock: targets, trail, time decay, collapse. Standalone, no parent src.
 * T1 fixed for profit protection; T2 boosted by favorable velocity; T1-before-T2 enforced; resolution-soon stricter.
 */

import { config } from "../config";
import type { PositionState, Signal } from "../types";

function targetPrice(entry: number, alpha: number): number {
  return entry + alpha * (1 - entry);
}

export interface ProfitLockOptions {
  tightenProfitLock?: boolean;
  /** When false (velocity favorable), we skip collapse at threshold and use threshold+0.06 when favorable. When true or undefined, collapse at threshold. */
  velocityAdverse?: boolean;
  /** Seconds until market end. When <= RESOLUTION_SOON_SEC, use normal collapse threshold (stricter). */
  leftTimeSec?: number;
  /** Signed velocity $/s. Positive = BTC up. Used for T2 boost when favorable. */
  velocitySigned?: number | null;
}

export function evaluateProfitLock(
  position: PositionState,
  mid: number,
  nowSec: number,
  marketStartSec: number,
  tightenProfitLock?: boolean,
  velocityAdverse?: boolean,
  options?: ProfitLockOptions
): Signal {
  const opts = options ?? {};
  const leftTimeSec = opts.leftTimeSec;
  const velocitySigned = opts.velocitySigned;
  const midVal = mid ?? position.entryPrice;

  /** Profit lock: in any case, if price reaches over threshold, sell all. */
  if (midVal > config.PROFIT_LOCK_SELL_ALL_ABOVE) {
    return { type: "flatten", reason: `price ${midVal.toFixed(2)} > ${config.PROFIT_LOCK_SELL_ALL_ABOVE}` };
  }

  const elapsedMin = (nowSec - marketStartSec) / 60;
  const holdSec = nowSec - position.entryTimeSec;
  const adverse = position.entryPrice - midVal;

  const flattenByMin = tightenProfitLock
    ? config.FLATTEN_BY_MIN * config.FLATTEN_TIGHTEN_MULT
    : config.FLATTEN_BY_MIN;
  const trailMin = tightenProfitLock ? config.TRAIL_MIN * config.TRAIL_TIGHTEN_MULT : config.TRAIL_MIN;
  const trailMax = tightenProfitLock ? config.TRAIL_MAX * config.TRAIL_TIGHTEN_MULT : config.TRAIL_MAX;

  const nearResolution = leftTimeSec != null && leftTimeSec <= config.RESOLUTION_SOON_SEC;

  /** Collapse: near resolution → always use normal threshold. Else adverse at threshold, or favorable at threshold+0.06. */
  if (adverse >= config.COLLAPSE_THRESHOLD) {
    if (nearResolution || velocityAdverse !== false) {
      return { type: "collapse", sizeRatio: 0.5, reason: `adverse ${(adverse * 100).toFixed(1)}%` };
    }
  }
  const collapseFavorableThreshold = config.COLLAPSE_THRESHOLD + 0.06;
  if (!nearResolution && velocityAdverse === false && adverse >= collapseFavorableThreshold) {
    return { type: "collapse", sizeRatio: 0.5, reason: `adverse ${(adverse * 100).toFixed(1)}% (favorable velocity)` };
  }

  /** T1 fixed. T2: base ALPHA2 + boost when velocity favorable (amount depends on velocity); no boost when adverse or unknown. */
  const P1 = targetPrice(position.entryPrice, config.ALPHA1);
  let alpha2 = config.ALPHA2;
  if (velocityAdverse === false && velocitySigned != null && Number.isFinite(velocitySigned)) {
    const favorableMag =
      position.outcome === "Up" ? Math.max(0, velocitySigned) : Math.max(0, -velocitySigned);
    const boost = Math.min(
      favorableMag * config.PL_T2_BOOST_VELOCITY_SCALE,
      config.PL_T2_BOOST_MAX_ALPHA
    );
    alpha2 = Math.min(config.ALPHA2 + boost, 0.99);
  }
  const P2 = Math.min(targetPrice(position.entryPrice, alpha2), 0.99);

  /** T1-before-T2: if price already at P2, take T1 first (so we never skip T1 on a gap move). */
  if (midVal >= P2 && !position.t2Hit) {
    if (!position.t1Hit) {
      return { type: "sell_partial_t1", sizeRatio: config.R1, reason: `T1 @ ${P1.toFixed(2)}` };
    }
    return { type: "sell_partial_t2", sizeRatio: config.R2, reason: `T2 @ ${P2.toFixed(2)}` };
  }
  if (midVal >= P1 && !position.t1Hit) {
    return { type: "sell_partial_t1", sizeRatio: config.R1, reason: `T1 @ ${P1.toFixed(2)}` };
  }

  const favorable = midVal >= position.entryPrice;
  const canTrail = position.t1Hit || (favorable && holdSec >= 30);
  if (canTrail && position.remainingShares > 0) {
    const D = (trailMin + trailMax) / 2;
    const trailLevel = position.highWaterMark - D;
    if (midVal <= trailLevel) {
      return { type: "sell_trail", reason: `trail @ ${trailLevel.toFixed(2)}` };
    }
  }

  if (elapsedMin >= flattenByMin) {
    return { type: "flatten", reason: `time ${elapsedMin.toFixed(1)}m` };
  }

  return { type: "none" };
}
