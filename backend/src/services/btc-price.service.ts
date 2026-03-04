import { Injectable } from '@nestjs/common';

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

/**
 * BTC price service. Matches tracker logic so backend "BTC open" aligns with tracker.
 * Polymarket's site may show a different open if they use another oracle (e.g. Chainlink)
 * or a different timestamp; we use Binance 1m kline open for the market's start minute.
 */
@Injectable()
export class BtcPriceService {
  async getBtcPriceUsd(): Promise<number | null> {
    try {
      let price = await this.fetchBinanceTicker();
      if (price != null) return price;
      const fallback = process.env.BTC_FALLBACK_URL || COINGECKO_URL;
      price = await this.fetchUrl(fallback, 'coingecko');
      return price ?? null;
    } catch {
      return null;
    }
  }

  /**
   * BTC price at a given Unix timestamp (seconds). Uses Binance 1m kline open for that minute.
   * Same as tracker's getBtcPriceUsdAtTime — no fallback for historical (Binance only).
   */
  async getBtcPriceUsdAtTime(unixSeconds: number): Promise<number | null> {
    try {
      const startMs = Math.floor(Number(unixSeconds) / 60) * 60 * 1000;
      const url = `${BINANCE_KLINES_URL}?symbol=BTCUSDT&interval=1m&startTime=${startMs}&limit=1`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Btc5Backend/1.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      const kline = Array.isArray(data) && data.length > 0 ? (data[0] as unknown[]) : null;
      if (!kline || kline.length < 2) return null;
      const openStr = kline[1];
      const price = typeof openStr === 'number' ? openStr : parseFloat(String(openStr));
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  private async fetchBinanceTicker(): Promise<number | null> {
    const res = await fetch(BINANCE_TICKER_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'Btc5Backend/1.0' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const price = data.price != null ? parseFloat(data.price) : NaN;
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  private async fetchUrl(url: string, _type: 'coingecko'): Promise<number | null> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Btc5Backend/1.0' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { bitcoin?: { usd?: number } };
    const price = data?.bitcoin?.usd;
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  }
}
