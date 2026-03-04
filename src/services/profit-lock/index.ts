/**
 * Profit Lock Engine — layered hybrid profit lock for 5m BTC prediction markets.
 * Design: docs/PROFIT_LOCK_ENGINE.md
 */

export {
  type VolRegime,
  type ProfitLockParams,
  type ProfitLockPositionState,
  type ProfitLockAction,
  type ProfitLockActionType,
  type ProfitLockInput,
  type ProfitLockEvaluator,
  type OrderBookSnapshot,
  DEFAULT_PROFIT_LOCK_PARAMS,
} from "./types";
export { evaluateProfitLock, updateHighWaterMark } from "./evaluator";
