/**
 * ETH price fetcher for v2. Binance first, then optional fallback.
 * No import from parent src.
 */

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT";
const COINGECKO_FALLBACK_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

async function fetchEthFromUrl(url: string): Promise<number | null> {
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
  const d = data as { ethereum?: { usd?: number } };
  const price = d?.ethereum?.usd;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

export async function getEthPriceUsd(): Promise<number | null> {
  try {
    let price = await fetchEthFromUrl(BINANCE_TICKER_URL);
    if (price != null) return price;
    const fallbackUrl = process.env.ETH_FALLBACK_URL || COINGECKO_FALLBACK_URL;
    price = await fetchEthFromUrl(fallbackUrl);
    return price ?? null;
  } catch {
    return null;
  }
}
