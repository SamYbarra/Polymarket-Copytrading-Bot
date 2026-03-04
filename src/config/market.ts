/**
 * Market configuration: single source of truth for window duration and slug.
 * BTC 5m fork: 5-minute windows, slug prefix btc-updown-5m-.
 */

const MARKET_WINDOW_MINUTES = parseInt(process.env.MARKET_WINDOW_MINUTES || "5", 10);
const WINDOW_SECONDS = MARKET_WINDOW_MINUTES * 60;

/** Polymarket slug prefix for this market type (e.g. btc-updown-5m-) */
export const SLUG_PREFIX = process.env.MARKET_SLUG_PREFIX || "btc-updown-5m-";

/** Window duration in minutes (5 for BTC 5m) */
export const marketWindowMinutes = (): number => MARKET_WINDOW_MINUTES;

/** Window duration in seconds */
export const marketWindowSeconds = (): number => WINDOW_SECONDS;

/** Current window start timestamp (aligned with Polymarket) */
export function getCurrentWindowTs(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
}

/** Default prediction time in minutes (e.g. 3 for 5m window). Used for approve timing when window not set. */
export const defaultPredictionTimeMinutes = (): number =>
  parseInt(process.env.PREDICTION_TIME_MINUTES || "3", 10);

/** Prediction time window: only predict when minutesElapsed is in [min, max]. Default 2–4 for 5m. */
export const defaultPredictionTimeMinMinutes = (): number =>
  parseInt(process.env.PREDICTION_TIME_MIN || process.env.PREDICTION_TIME_MINUTES || "2", 10);
export const defaultPredictionTimeMaxMinutes = (): number =>
  parseInt(process.env.PREDICTION_TIME_MAX || "4", 10);

/** Min seconds after market start before we predict/buy (default 150 = 2.5 min). No prediction or buy before this. */
export const predictionMinElapsedSeconds = (): number =>
  parseInt(process.env.PREDICTION_MIN_ELAPSED_SECONDS || "150", 10);

/** Seconds between retry predictions when we did not buy. Next process cycle after this. Default 20. */
export const predictionRetryIntervalSeconds = (): number =>
  parseInt(process.env.PREDICTION_RETRY_INTERVAL_SECONDS || "20", 10);

/** Seconds between full sync from Data API positions (heavy). Trades used in between. Default 90. */
export const positionsSyncIntervalSeconds = (): number =>
  parseInt(process.env.POSITIONS_SYNC_INTERVAL_SECONDS || "90", 10);

/** Default number of recent markets for hot-wallet window (e.g. 60 × 5m ≈ 5h) */
export const defaultHotWalletRecentMarkets = (): number =>
  parseInt(process.env.HOT_WALLET_RECENT_MARKETS || "60", 10);
