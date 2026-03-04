/**
 * Polymarket API client (BTC 5m market: config-driven window and slug)
 */

import { SLUG_PREFIX, marketWindowSeconds, getCurrentWindowTs } from "../config/market";
import type {
  GammaEvent,
  MarketInfo,
  DataApiTrade,
  Btc5MarketTradingState,
  WalletTradeData,
} from "../types";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const GAMMA_EVENTS_URL = `${GAMMA_API_BASE}/events`;
const GAMMA_MARKETS_URL = `${GAMMA_API_BASE}/markets`;
const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_BOOK_URL = "https://clob.polymarket.com/book";

const FETCH_OPTIONS: RequestInit = {
  headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
};

export interface OrderBook {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

export class PolymarketClient {
  /**
   * Get current window start timestamp (5m-aligned for BTC 5m)
   */
  getCurrentWindowTs(): number {
    return getCurrentWindowTs();
  }

  /**
   * Fetch event by slug. Uses official path GET /events/slug/{slug} first (returns single Event);
   * falls back to query GET /events?slug=... (returns array).
   */
  async getEventBySlug(slug: string): Promise<GammaEvent | null> {
    try {
      const pathRes = await fetch(`${GAMMA_EVENTS_URL}/slug/${encodeURIComponent(slug)}`, FETCH_OPTIONS);
      if (pathRes.ok) {
        const pathData = (await pathRes.json()) as unknown;
        if (pathData && typeof pathData === "object" && (pathData as GammaEvent).slug != null)
          return pathData as GammaEvent;
      }
      const queryRes = await fetch(`${GAMMA_EVENTS_URL}?slug=${encodeURIComponent(slug)}`, FETCH_OPTIONS);
      if (!queryRes.ok) return null;
      const queryData = await queryRes.json();
      return Array.isArray(queryData) && queryData.length > 0 ? (queryData[0] as GammaEvent) : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch BTC 5m event by slug timestamp (current window or any 5m-aligned ts).
   */
  async getBtcEvent(slugTs: number): Promise<GammaEvent | null> {
    const slug = `${SLUG_PREFIX}${slugTs}`;
    return this.getEventBySlug(slug);
  }

  /**
   * Get market info from event
   */
  getMarketInfo(event: GammaEvent): MarketInfo | null {
    const markets = event.markets || [];
    if (markets.length === 0 || !markets[0].conditionId) return null;

    const m = markets[0];
    const conditionId = m.conditionId!;
    const startTime = m.eventStartTime
      ? Math.floor(new Date(m.eventStartTime).getTime() / 1000)
      : m.startDate
        ? Math.floor(new Date(m.startDate).getTime() / 1000)
        : event.startDate
          ? Math.floor(new Date(event.startDate).getTime() / 1000)
          : 0;

    const endTime = startTime + marketWindowSeconds();

    return {
      conditionId,
      eventSlug: event.slug || "",
      startTime,
      endTime,
      isActive: !event.endDate && Date.now() / 1000 < endTime,
    };
  }

  /**
   * Parse trading state from Gamma API market object (event.markets[0]).
   * Per Polymarket docs: Market includes bestBid, bestAsk, lastTradePrice, volume, volume24hr, outcomePrices, spread, active, closed, clobTokenIds.
   */
  private parseTradingState(m: Record<string, unknown> | null): Btc5MarketTradingState {
    if (!m || typeof m !== "object") {
      return {
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: null,
        volume24hr: null,
        outcomePrices: null,
        spread: null,
        active: null,
        closed: null,
        upTokenId: null,
        downTokenId: null,
      };
    }
    const num = (key: string): number | null => {
      const v = m[key];
      if (v == null) return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    let outcomePrices: [number, number] | null = null;
    const op = m.outcomePrices;
    if (typeof op === "string") {
      try {
        const arr = op.startsWith("[") ? JSON.parse(op) : op.split(",").map((s: string) => parseFloat(s.trim()));
        if (Array.isArray(arr) && arr.length >= 2)
          outcomePrices = [Number(arr[0]), Number(arr[1])];
      } catch {
        // ignore
      }
    } else if (Array.isArray(op) && op.length >= 2) {
      outcomePrices = [parseFloat(String(op[0])), parseFloat(String(op[1]))];
    }
    let upTokenId: string | null = null;
    let downTokenId: string | null = null;
    const clob = m.clobTokenIds;
    if (typeof clob === "string") {
      try {
        const ids = clob.startsWith("[") ? JSON.parse(clob) : clob.split(",").map((s: string) => s.trim());
        if (Array.isArray(ids)) {
          upTokenId = ids[0] ? String(ids[0]) : null;
          downTokenId = ids[1] ? String(ids[1]) : null;
        }
      } catch {
        const parts = clob.split(",").map((s: string) => s.trim());
        upTokenId = parts[0] || null;
        downTokenId = parts[1] || null;
      }
    } else if (Array.isArray(clob) && clob.length >= 2) {
      upTokenId = String(clob[0]);
      downTokenId = String(clob[1]);
    }
    return {
      bestBid: num("bestBid"),
      bestAsk: num("bestAsk"),
      lastTradePrice: num("lastTradePrice"),
      volume: num("volume") ?? num("volumeNum"),
      volume24hr: num("volume24hr"),
      outcomePrices,
      spread: num("spread"),
      active: typeof m.active === "boolean" ? m.active : null,
      closed: typeof m.closed === "boolean" ? m.closed : null,
      upTokenId,
      downTokenId,
    };
  }

  /**
   * Get current BTC 5m market and its trading state in one call.
   * Uses official Gamma API: GET /events/slug/{slug} → event with markets[] (each market has bestBid, bestAsk, volume, etc.).
   */
  async getCurrentBtc5MarketWithTradingState(): Promise<{
    marketInfo: MarketInfo;
    tradingState: Btc5MarketTradingState;
    event: GammaEvent;
  } | null> {
    const slugTs = getCurrentWindowTs();
    const event = await this.getBtcEvent(slugTs);
    if (!event?.markets?.length) return null;
    const marketInfo = this.getMarketInfo(event);
    if (!marketInfo) return null;
    const m = event.markets[0] as Record<string, unknown>;
    const tradingState = this.parseTradingState(m);
    return { marketInfo, tradingState, event };
  }

  /**
   * Parse outcomePrices from a market and return Up/Down if resolved.
   */
  private parseOutcomePrices(outcomePrices: unknown): "Up" | "Down" | null {
    if (outcomePrices == null) return null;
    let prices: number[];
    if (typeof outcomePrices === "string") {
      const trimmed = outcomePrices.trim();
      if (trimmed.startsWith("[")) {
        try {
          const arr = JSON.parse(trimmed);
          prices = Array.isArray(arr) ? arr.map((x) => parseFloat(String(x))) : [];
        } catch {
          prices = trimmed.split(",").map((s) => parseFloat(s.trim()));
        }
      } else {
        prices = trimmed.split(",").map((s) => parseFloat(s.trim()));
      }
    } else if (Array.isArray(outcomePrices)) {
      prices = outcomePrices.map((x) => parseFloat(String(x)));
    } else {
      return null;
    }
    if (prices.length < 2) return null;
    const up = prices[0];
    const down = prices[1];
    if (up >= 0.99 && down <= 0.01) return "Up";
    if (down >= 0.99 && up <= 0.01) return "Down";
    return null;
  }

  async getResolutionOutcome(eventSlug: string, conditionId: string): Promise<"Up" | "Down" | null> {
    const event = await this.getEventBySlug(eventSlug);
    if (!event?.markets?.length) return this.getResolutionOutcomeByConditionId(conditionId);

    const market = event.markets.find((m: any) => m.conditionId === conditionId) ?? event.markets[0];
    return this.parseOutcomePrices((market as any).outcomePrices);
  }

  async getResolutionOutcomeByConditionId(conditionId: string): Promise<"Up" | "Down" | null> {
    try {
      const url = `${GAMMA_MARKETS_URL}?condition_id=${encodeURIComponent(conditionId)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const markets = Array.isArray(data) ? data : [];
      const market = markets.find((m: any) => m.conditionId === conditionId) ?? markets[0];
      if (!market?.outcomePrices) return null;
      return this.parseOutcomePrices(market.outcomePrices);
    } catch {
      return null;
    }
  }

  /**
   * Get current market's per-wallet buy state (Up/Down) from Data API positions.
   * Per Polymarket docs: GET /v1/market-positions?market={conditionId} returns positions per outcome token;
   * aggregate by proxyWallet to get buyUpUsd / buyDownUsd per wallet. This is the correct source for
   * "who bought how much" and fixes missing data when /trades is incomplete.
   */
  /**
   * Fetch per-wallet buy state from Data API positions.
   * Logic: one position per (wallet, outcome) – we keep MAX usd per key so we never
   * sum duplicate rows (API can return same position across pages or per-token lists).
   * That fixes inflated volume (e.g. 130K vs real 31K).
   */
  async fetchMarketPositions(conditionId: string): Promise<WalletTradeData[]> {
    const marketParam = conditionId.startsWith("0x")
      ? conditionId.toLowerCase()
      : `0x${conditionId.toLowerCase()}`;
    const limit = 500;
    console.log("fetchMarketPositions are called ", conditionId);
    // Key: "wallet:up" | "wallet:down" → keep single value per (wallet, outcome), don't sum duplicates
    const byWalletOutcome = new Map<string, number>();

    const addPosition = (p: Record<string, unknown>): void => {
      const wallet =
        (p.proxyWallet as string) ?? (p.user as string);
      if (!wallet || typeof wallet !== "string") return;
      const totalBought =
        typeof p.totalBought === "number" ? p.totalBought : 0;
      const size = typeof p.size === "number" ? p.size : 0;
      const avgPrice = typeof p.avgPrice === "number" ? p.avgPrice : 0;
      const usd = totalBought > 0 ? totalBought : size * avgPrice;
      if (!Number.isFinite(usd) || usd <= 0) return;
      const outcomeIndex = typeof p.outcomeIndex === "number" ? p.outcomeIndex : -1;
      const outcome = p.outcome as string | undefined;
      const isUp =
        outcome === "Up" ||
        outcome === "Yes" ||
        outcomeIndex === 0;

      const key = `${wallet}:${isUp ? "up" : "down"}`;
      const prev = byWalletOutcome.get(key) ?? 0;
      byWalletOutcome.set(key, Math.max(prev, usd));
    };

    const parsePage = (list: unknown[]): void => {
      for (const item of list) {
        const withPositions = item as { token?: string; positions?: unknown[] };
        if (Array.isArray(withPositions.positions)) {
          for (const p of withPositions.positions) {
            addPosition(typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {});
          }
        } else if (
          (withPositions as Record<string, unknown>).proxyWallet != null ||
          (withPositions as Record<string, unknown>).user != null
        ) {
          addPosition(item as Record<string, unknown>);
        }
      }
    };

    try {
      for (let offset = 0; offset <= 5000; offset += limit) {
        const url = `${DATA_API_BASE}/v1/market-positions?market=${encodeURIComponent(marketParam)}&status=ALL&limit=${limit}&offset=${offset}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
        });
        if (!res.ok) break;
        const data = (await res.json()) as unknown;
        const list = Array.isArray(data) ? data : [];
        parsePage(list);
        const hasFullPage = list.some(
          (item: unknown) =>
            Array.isArray((item as { positions?: unknown[] }).positions) &&
            (item as { positions: unknown[] }).positions.length >= limit
        );
        if (!hasFullPage || list.length === 0) break;
      }

      const byWallet = new Map<string, { buyUpUsd: number; buyDownUsd: number }>();
      for (const [key, usd] of byWalletOutcome) {
        const lastColon = key.lastIndexOf(":");
        const wallet = lastColon > 0 ? key.slice(0, lastColon) : "";
        const side = lastColon > 0 ? key.slice(lastColon + 1) : "";
        if (!wallet || (side !== "up" && side !== "down")) continue;
        const cur = byWallet.get(wallet) ?? { buyUpUsd: 0, buyDownUsd: 0 };
        if (side === "up") cur.buyUpUsd += usd;
        else cur.buyDownUsd += usd;
        byWallet.set(wallet, cur);
      }

      const now = Math.floor(Date.now() / 1000);
      return Array.from(byWallet.entries()).map(([wallet, { buyUpUsd, buyDownUsd }]) => {
        const totalBuyUsd = buyUpUsd + buyDownUsd;
        return {
          wallet,
          totalBuyUsd,
          buyUpCount: buyUpUsd > 0 ? 1 : 0,
          buyDownCount: buyDownUsd > 0 ? 1 : 0,
          buyUpUsd,
          buyDownUsd,
          lastBuyTime: now,
        };
      });
    } catch {
      return [];
    }
  }

  async fetchMarketTrades(conditionId: string, minTimestamp?: number): Promise<DataApiTrade[]> {
    const params = new URLSearchParams();
    // Data API may be case-sensitive; normalize to lowercase 0x + 64 hex
    const marketParam = conditionId.startsWith("0x")
      ? conditionId.toLowerCase()
      : `0x${conditionId.toLowerCase()}`;
    params.set("market", marketParam);
    params.set("side", "BUY");
    params.set("limit", "1000");
    params.set("takerOnly", "false"); // include maker and taker so we see all BUY activity

    const url = `${DATA_API_BASE}/trades?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
      });
      if (!res.ok) return [];
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data as any)?.data ?? (data as any)?.trades ?? [];
      const trades = Array.isArray(raw) ? raw : [];
      if (minTimestamp) {
        return trades.filter((t) => {
          const ts = typeof t.timestamp === "number" ? t.timestamp : parseInt(String(t.timestamp), 10);
          return Number.isFinite(ts) && ts >= minTimestamp;
        });
      }
      return trades;
    } catch {
      return [];
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    try {
      const url = `${CLOB_BOOK_URL}?token_id=${encodeURIComponent(tokenId)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      if (data.error) return null;
      return {
        bids: data.bids || [],
        asks: data.asks || [],
      };
    } catch {
      return null;
    }
  }

  async getMarketTokenIds(eventSlug: string, conditionId: string): Promise<{ upTokenId: string | null; downTokenId: string | null }> {
    const event = await this.getEventBySlug(eventSlug);
    if (!event?.markets?.length) return { upTokenId: null, downTokenId: null };

    const market = event.markets.find((m: any) => m.conditionId === conditionId) ?? event.markets[0];
    const clobTokenIds = (market as any).clobTokenIds;
    if (!clobTokenIds) return { upTokenId: null, downTokenId: null };

    let tokenIds: string[] = [];
    if (typeof clobTokenIds === "string") {
      try {
        tokenIds = JSON.parse(clobTokenIds);
      } catch {
        tokenIds = clobTokenIds.split(",").map((s: string) => s.trim());
      }
    } else if (Array.isArray(clobTokenIds)) {
      tokenIds = clobTokenIds.map((x) => String(x));
    }

    return {
      upTokenId: tokenIds[0] || null,
      downTokenId: tokenIds[1] || null,
    };
  }
}
