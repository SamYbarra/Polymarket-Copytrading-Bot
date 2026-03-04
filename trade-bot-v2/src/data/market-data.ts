/**
 * Market data: copied from main PolymarketClient (events-first, same as realtime collector).
 * Self-contained, uses config for SLUG_PREFIX and WINDOW_SEC.
 */

import { config } from "../config";
import type { MarketInfo } from "../types";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";

const FETCH_OPTIONS: RequestInit = {
  headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5Tracker/1.0" },
};

interface GammaEvent {
  slug?: string;
  startDate?: string;
  endDate?: string;
  markets?: Array<{
    conditionId?: string;
    eventStartTime?: string;
    startDate?: string;
    clobTokenIds?: string[] | string;
    outcomes?: string[] | string;
    [key: string]: unknown;
  }>;
}

/** Current 5m window start (Unix sec). Same formula as main config/market. */
export function getCurrentWindowTs(): number {
  return Math.floor(Date.now() / 1000 / config.WINDOW_SEC) * config.WINDOW_SEC;
}

/** Slug for the current window. Same as main: SLUG_PREFIX + getCurrentWindowTs(). */
export function getSlugForCurrentWindow(): string {
  const prefix = (config.SLUG_PREFIX || "btc-updown-5m-").trim();
  return `${prefix}${getCurrentWindowTs()}`;
}

/** Fetch event by slug. GET /events/slug/{slug} first, then GET /events?slug=... (same as main client). */
async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
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

/** Get market info from event (same as main getMarketInfo). */
function getMarketInfo(event: GammaEvent): MarketInfo | null {
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

  const endTime = startTime + config.WINDOW_SEC;

  return {
    conditionId,
    eventSlug: event.slug || "",
    startTime,
    endTime,
  };
}

/** Parse clobTokenIds from market (Up/Down token IDs). */
function parseTokenIds(m: { clobTokenIds?: string[] | string } | undefined): { upTokenId: string | null; downTokenId: string | null } {
  const clob = m?.clobTokenIds;
  if (typeof clob === "string") {
    try {
      const ids = clob.startsWith("[") ? JSON.parse(clob) : clob.split(",").map((s: string) => s.trim());
      if (Array.isArray(ids))
        return { upTokenId: ids[0] ? String(ids[0]) : null, downTokenId: ids[1] ? String(ids[1]) : null };
    } catch {
      const parts = clob.split(",").map((s: string) => s.trim());
      return { upTokenId: parts[0] || null, downTokenId: parts[1] || null };
    }
  }
  if (Array.isArray(clob) && clob.length >= 2)
    return { upTokenId: String(clob[0]), downTokenId: String(clob[1]) };
  return { upTokenId: null, downTokenId: null };
}

/** Get current BTC 5m market and token IDs. Same flow as main PolymarketClient.getCurrentBtc5MarketWithTradingState (events first, instant). */
export async function getCurrentMarket(): Promise<{
  marketInfo: MarketInfo;
  upTokenId: string;
  downTokenId: string;
} | null> {
  const slugTs = getCurrentWindowTs();
  const slug = `${(config.SLUG_PREFIX || "btc-updown-5m-").trim()}${slugTs}`;
  const event = await getEventBySlug(slug);
  if (!event?.markets?.length) return null;

  const marketInfo = getMarketInfo(event);
  if (!marketInfo) return null;

  const m = event.markets[0];
  let { upTokenId, downTokenId } = parseTokenIds(m);
  if (!upTokenId || !downTokenId) {
    const market = event.markets.find((x) => x.conditionId === marketInfo.conditionId) ?? event.markets[0];
    const ids = parseTokenIds(market);
    upTokenId = ids.upTokenId;
    downTokenId = ids.downTokenId;
  }
  if (!upTokenId || !downTokenId) return null;

  return { marketInfo, upTokenId, downTokenId };
}
