const MARKET_WINDOW_MINUTES = parseInt(process.env.MARKET_WINDOW_MINUTES || '5', 10);
const WINDOW_SECONDS = MARKET_WINDOW_MINUTES * 60;

export const SLUG_PREFIX = process.env.MARKET_SLUG_PREFIX || 'btc-updown-5m-';
export function marketWindowSeconds(): number {
  return WINDOW_SECONDS;
}
export function getCurrentWindowTs(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
}
