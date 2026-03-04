/**
 * BTC price: primary from Binance, fallback when env BTC_FALLBACK_URL is set or Binance fails.
 * Polymarket resolution may use a different oracle (e.g. Chainlink); document in README.
 */

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const COINGECKO_FALLBACK_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

async function fetchBtcFromUrl(url: string): Promise<number | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  if (url.includes("binance")) {
    const d = data as { price?: string };
    const price = d.price != null ? parseFloat(String(d.price)) : NaN;
    return Number.isFinite(price) && price > 0 ? price : null;
  }
  const d = data as { bitcoin?: { usd?: number } };
  const price = d?.bitcoin?.usd;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

export async function getBtcPriceUsd(): Promise<number | null> {
  try {
    let price = await fetchBtcFromUrl(BINANCE_TICKER_URL);
    if (price != null) return price;
    const fallbackUrl = process.env.BTC_FALLBACK_URL || COINGECKO_FALLBACK_URL;
    price = await fetchBtcFromUrl(fallbackUrl);
    return price ?? null;
  } catch {
    return null;
  }
}

/**
 * BTC price at a given Unix timestamp (seconds). Uses Binance 1m kline open for that minute.
 * No fallback for historical (Binance only). Polymarket resolution may use a different
 * oracle (e.g. Chainlink) — displayed "open" on the site can differ from this.
 */
export async function getBtcPriceUsdAtTime(unixSeconds: number): Promise<number | null> {
  try {
    const startMs = Math.floor(Number(unixSeconds) / 60) * 60 * 1000;
    const url = `${BINANCE_KLINES_URL}?symbol=BTCUSDT&interval=1m&startTime=${startMs}&limit=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const kline = Array.isArray(data) && data.length > 0 ? (data[0] as unknown[]) : null;
    if (!kline || kline.length < 2) return null;
    const openStr = kline[1];
    const price = typeof openStr === "number" ? openStr : parseFloat(String(openStr));
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
