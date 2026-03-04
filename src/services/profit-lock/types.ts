/**
 * Profit Lock Engine — types and parameter ranges.
 * Design: docs/PROFIT_LOCK_ENGINE.md
 */

export type VolRegime = "low" | "normal" | "high";

export interface ProfitLockParams {
  /** First target as fraction of max payoff (0.15–0.25 normal). */
  alpha1: number;
  /** Second target (0.40–0.55 normal). */
  alpha2: number;
  /** Third target, low vol only (0.70–0.85). */
  alpha3: number;
  /** Tactical share ratio at T1 (0.25–0.35). */
  r1: number;
  /** Core share ratio at T2 (0.45–0.55). */
  r2: number;
  /** Min trailing distance in price (0.02–0.03). */
  trailMin: number;
  /** Max trailing distance in price (0.08–0.12). */
  trailMax: number;
  /** Vol regime threshold: short/long < lowBound => low. */
  volRegimeLowBound: number;
  /** Vol regime threshold: short/long > highBound => high. */
  volRegimeHighBound: number;
  /** Anti-whipsaw cooldown (seconds). */
  trailCooldownSec: number;
  /** Max hold from entry (seconds). */
  maxHoldSec: number;
  /** Minutes elapsed to start de-risk (e.g. 4.0). */
  deriskStartMin: number;
  /** Minutes elapsed to flatten remaining (e.g. 4.5). */
  flattenByMin: number;
  /** Adverse move (price) to trigger collapse exit. */
  collapseThreshold: number;
  /** Re-entry size as fraction of original (0.33–0.50). */
  reentrySizeRatio: number;
  /** Re-entry cooldown (seconds). */
  reentryCooldownSec: number;
}

/** Default parameter ranges for 5-minute BTC markets. */
export const DEFAULT_PROFIT_LOCK_PARAMS: ProfitLockParams = {
  alpha1: 0.20,
  alpha2: 0.50,
  alpha3: 0.75,
  r1: 0.30,
  r2: 0.50,
  trailMin: 0.025,
  trailMax: 0.10,
  volRegimeLowBound: 0.7,
  volRegimeHighBound: 1.2,
  trailCooldownSec: 18,
  maxHoldSec: 105,
  deriskStartMin: 4.0,
  flattenByMin: 4.5,
  collapseThreshold: 0.10,
  reentrySizeRatio: 0.5,
  reentryCooldownSec: 45,
};

export interface OrderBookSnapshot {
  bestBid: number;
  bestAsk: number;
  spread: number;
  /** Depth on our side (e.g. ask for we hold Up) in shares. */
  depthOurSide: number;
}

export interface ProfitLockPositionState {
  conditionId: string;
  predictedOutcome: "Up" | "Down";
  entryPrice: number;
  confidence: number;
  shares: number;
  entryTimeSec: number;
  /** Whether T1 partial exit was executed. */
  t1Hit: boolean;
  /** Whether T2 partial exit was executed. */
  t2Hit: boolean;
  /** Bayesian posterior P(continuation) after T1. */
  posteriorCont?: number;
  /** Trailing: highest mid seen (high water mark). */
  highWaterMark: number;
  /** Last time we moved trail (for cooldown). */
  lastTrailUpdateSec?: number;
  /** Bayesian update applied once after T1. */
  bayesianUpdated: boolean;
  /** Remaining shares after partials. */
  remainingShares: number;
}

export type ProfitLockActionType =
  | "hold"
  | "sell_partial_t1"
  | "sell_partial_t2"
  | "sell_partial_t3"
  | "sell_trail"
  | "flatten_remaining"
  | "exit_collapse";

export interface ProfitLockAction {
  type: ProfitLockActionType;
  /** For partials: ratio of (original) position or exact shares. */
  sizeRatio?: number;
  shares?: number;
  /** Price level (for logging). */
  level?: number;
  reason?: string;
}

export interface ProfitLockInput {
  position: ProfitLockPositionState;
  marketStartTimeSec: number;
  marketEndTimeSec: number;
  book: OrderBookSnapshot;
  volRegime: VolRegime;
  /** Current mid price. */
  mid: number;
  /** Current time (seconds). */
  nowSec: number;
}

/**
 * Single evaluation: given position, market, book, vol regime — return action or hold.
 */
export type ProfitLockEvaluator = (
  input: ProfitLockInput,
  params: ProfitLockParams
) => ProfitLockAction;
