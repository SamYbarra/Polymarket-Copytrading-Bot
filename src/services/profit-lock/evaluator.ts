/**
 * Profit Lock evaluator: one-cycle decision from position, book, time, vol regime.
 * Design: docs/PROFIT_LOCK_ENGINE.md
 */

import type {
  ProfitLockInput,
  ProfitLockParams,
  ProfitLockAction,
  ProfitLockPositionState,
  VolRegime,
} from "./types";

/** Get vol-adaptive alpha1, alpha2, alpha3. */
function getAlphas(params: ProfitLockParams, volRegime: VolRegime): { a1: number; a2: number; a3: number } {
  const { alpha1, alpha2, alpha3, volRegimeLowBound, volRegimeHighBound } = params;
  if (volRegime === "low") {
    return { a1: alpha1 * 0.9, a2: alpha2 * 0.95, a3: alpha3 };
  }
  if (volRegime === "high") {
    return { a1: Math.min(0.3, alpha1 + 0.05), a2: Math.min(0.65, alpha2 + 0.1), a3: 1 };
  }
  return { a1: alpha1, a2: alpha2, a3: alpha3 };
}

/** Target price for outcome (Up or Down): entry + alpha * (1 - entry). */
function targetPrice(entryPrice: number, alpha: number): number {
  return entryPrice + alpha * (1 - entryPrice);
}

/**
 * Single-cycle evaluation. Returns first action that fires (priority: collapse > T1 > T2 > T3 > trail > time > hold).
 */
export function evaluateProfitLock(input: ProfitLockInput, params: ProfitLockParams): ProfitLockAction {
  const { position, marketStartTimeSec, marketEndTimeSec, book, volRegime, mid, nowSec } = input;
  const { predictedOutcome, entryPrice, confidence, remainingShares, t1Hit, t2Hit, highWaterMark } = position;

  const minutesElapsed = (nowSec - marketStartTimeSec) / 60;
  const holdSec = nowSec - position.entryTimeSec;

  // --- Layer 6: Collapse ---
  const adverseMove = entryPrice - mid;
  if (adverseMove >= params.collapseThreshold) {
    return {
      type: "exit_collapse",
      sizeRatio: 0.5,
      reason: `adverse move ${(adverseMove * 100).toFixed(1)}%`,
    };
  }

  const { a1, a2, a3 } = getAlphas(params, volRegime);
  const P_t1 = targetPrice(entryPrice, a1);
  const P_t2 = targetPrice(entryPrice, a2);
  const P_t3 = targetPrice(entryPrice, a3);

  const favorable = mid >= entryPrice;

  // --- Layer 1+2: Partial targets ---
  const hitT1 = predictedOutcome === "Up" ? mid >= P_t1 : mid >= P_t1;
  const hitT2 = predictedOutcome === "Up" ? mid >= P_t2 : mid >= P_t2;
  const hitT3 = predictedOutcome === "Up" ? mid >= P_t3 : mid >= P_t3;

  if (hitT1 && !t1Hit) {
    return {
      type: "sell_partial_t1",
      sizeRatio: params.r1,
      level: P_t1,
      reason: `T1 @ ${P_t1.toFixed(2)}`,
    };
  }
  if (hitT2 && !t2Hit) {
    return {
      type: "sell_partial_t2",
      sizeRatio: params.r2,
      level: P_t2,
      reason: `T2 @ ${P_t2.toFixed(2)}`,
    };
  }
  if (volRegime === "low" && hitT3) {
    return {
      type: "sell_partial_t3",
      sizeRatio: 1,
      level: P_t3,
      reason: `T3 @ ${P_t3.toFixed(2)}`,
    };
  }

  // --- Layer 4: Trailing (after T1 or 30s in profit) ---
  const canTrail = t1Hit || (favorable && holdSec >= 30);
  if (canTrail && remainingShares > 0) {
    const volMult = volRegime === "high" ? 1.3 : volRegime === "low" ? 0.9 : 1;
    const edgeMult = 1 - 0.15 * (confidence - 0.5);
    const D = Math.max(
      params.trailMin,
      Math.min(params.trailMax, (params.trailMin + params.trailMax) / 2 * volMult * edgeMult)
    );
  const trailLevel = highWaterMark - D;
  const hitTrail = mid <= trailLevel;
    if (hitTrail) {
      return {
        type: "sell_trail",
        level: trailLevel,
        reason: `trail @ ${trailLevel.toFixed(2)}`,
      };
    }
  }

  // --- Layer 5: Time decay ---
  if (minutesElapsed >= params.flattenByMin) {
    return {
      type: "flatten_remaining",
      reason: `time ${minutesElapsed.toFixed(1)}m`,
    };
  }

  return { type: "hold" };
}

/**
 * Update high water mark for trailing. Call when mid is better than current HWM.
 */
export function updateHighWaterMark(
  position: ProfitLockPositionState,
  mid: number
): void {
  if (mid > position.highWaterMark) position.highWaterMark = mid;
}
