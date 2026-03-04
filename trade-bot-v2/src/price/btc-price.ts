/**
 * BTC price fetcher for v2. Binance first, then optional fallback.
 * No import from parent src.
 */

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
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
