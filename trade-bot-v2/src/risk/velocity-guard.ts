/**
 * Velocity risk guard: direction-aware allowBuy / reduceSize / tightenProfitLock.
 * Only treats velocity as risk when adverse (against position/outcome).
 * When favorable but projected move (leftTime × velocity) < min USD → insufficient momentum → tighten.
 */

import { config } from "../config";

export interface VelocityGuardResult {
  allowBuy: boolean;
  reduceSize: boolean;
  tightenProfitLock: boolean;
  /** True when buy was blocked because velocity direction is adverse (skip-buy-on-any-adverse or above block threshold). */
  blockedByAdverseVelocity?: boolean;
}

export interface VelocityGuardInput {
  /** Absolute velocity $/s (from getVelocity()). */
  velocityAbs: number | null;
  /** Signed velocity $/s (from getVelocitySigned()). Positive = BTC up. */
  velocitySigned: number | null;
  /** "Up" | "Down" for direction check; null = use absolute only (block on high |velocity|). */
  outcome: "Up" | "Down" | null;
  /** Seconds until market end. Used for insufficient-momentum (only when outcome set). */
  leftTimeSec?: number;
}

/**
 * Direction-aware: block/reduce/tighten only when velocity is adverse for outcome.
 * Insufficient momentum: when velocity is favorable but leftTime × velocity < MIN_PROJECTED_USD → tighten.
 */
export function evaluateVelocityGuard(input: VelocityGuardInput): VelocityGuardResult {
  const { velocityAbs, velocitySigned, outcome, leftTimeSec } = input;
  if (velocityAbs == null || !Number.isFinite(velocityAbs)) {
    return { allowBuy: true, reduceSize: false, tightenProfitLock: false };
  }

  const adverse =
    outcome === "Up"
      ? (velocitySigned ?? 0) < 0
      : outcome === "Down"
        ? (velocitySigned ?? 0) > 0
        : true; // outcome null: treat any high velocity as risk (backward compat)
  const favorable =
    outcome === "Up"
      ? (velocitySigned ?? 0) > 0
      : outcome === "Down"
        ? (velocitySigned ?? 0) < 0
        : false;

  const blockByThreshold = adverse && velocityAbs >= config.VELOCITY_BLOCK_USD_PER_SEC;
  const blockByAdverseDirection = config.VELOCITY_SKIP_BUY_ON_ANY_ADVERSE && adverse && outcome != null;
  const allowBuy = !blockByThreshold && !blockByAdverseDirection;
  const blockedByAdverseVelocity = blockByThreshold || blockByAdverseDirection;
  const reduceSize = adverse && velocityAbs >= config.VELOCITY_REDUCE_USD_PER_SEC && allowBuy;

  let tightenProfitLock = adverse && velocityAbs >= config.VELOCITY_TIGHTEN_USD_PER_SEC;

  if (!tightenProfitLock && favorable && outcome != null && leftTimeSec != null && leftTimeSec > 0 && velocitySigned != null && Number.isFinite(velocitySigned)) {
    const projectedMoveUsd =
      outcome === "Up"
        ? velocitySigned * leftTimeSec
        : -velocitySigned * leftTimeSec;
    if (projectedMoveUsd >= 0 && projectedMoveUsd < config.INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD) {
      tightenProfitLock = true;
    }
  }

  return { allowBuy, reduceSize, tightenProfitLock, blockedByAdverseVelocity };
}
