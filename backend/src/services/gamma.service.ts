import { Injectable } from '@nestjs/common';
import {
  SLUG_PREFIX,
  getCurrentWindowTs,
  marketWindowSeconds,
} from '../config/market.config';

const GAMMA_EVENTS_URL = 'https://gamma-api.polymarket.com/events';
const CLOB_MIDPOINTS_URL = 'https://clob.polymarket.com/midpoints';

export interface CurrentMarket {
  eventSlug: string;
  conditionId: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
}

function parseMidpoint(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

@Injectable()
export class GammaService {
  async getCurrentMarket(): Promise<CurrentMarket | null> {
    const ts = getCurrentWindowTs();
    const slug = `${SLUG_PREFIX}${ts}`;
    try {
      const res = await fetch(
        `${GAMMA_EVENTS_URL}?slug=${encodeURIComponent(slug)}`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      const event = Array.isArray(data) && data.length > 0
        ? data[0]
        : data?.markets
          ? data
          : null;
      if (!event?.markets?.length || !event.markets[0].conditionId) return null;
      const m = event.markets[0];
      const startTime = m.eventStartTime
        ? Math.floor(new Date(m.eventStartTime).getTime() / 1000)
        : m.startDate
          ? Math.floor(new Date(m.startDate).getTime() / 1000)
          : ts;
      const endTime = startTime + marketWindowSeconds();
      const now = Math.floor(Date.now() / 1000);
      return {
        eventSlug: event.slug || slug,
        conditionId: m.conditionId,
        startTime,
        endTime,
        isActive: now < endTime,
      };
    } catch {
      return null;
    }
  }

  async getMidpoints(eventSlug: string, conditionId: string): Promise<{
    upMidPrice: number | null;
    downMidPrice: number | null;
    upTokenId: string | null;
    downTokenId: string | null;
  }> {
    let upMidPrice: number | null = null;
    let downMidPrice: number | null = null;
    let upTokenId: string | null = null;
    let downTokenId: string | null = null;
    try {
      const eventRes = await fetch(
        `${GAMMA_EVENTS_URL}?slug=${encodeURIComponent(eventSlug)}`,
      );
      if (!eventRes.ok) return { upMidPrice, downMidPrice, upTokenId, downTokenId };
      const eventData = await eventRes.json();
      const event = Array.isArray(eventData) && eventData.length > 0
        ? eventData[0]
        : eventData?.markets
          ? eventData
          : null;
      const markets = event?.markets || [];
      const market =
        markets.find((x: { conditionId?: string }) => x.conditionId === conditionId) ??
        markets[0];
      let tokenIds: string[] = [];
      const clobTokenIds = market?.clobTokenIds;
      if (clobTokenIds) {
        if (typeof clobTokenIds === 'string') {
          try {
            tokenIds = JSON.parse(clobTokenIds);
          } catch {
            tokenIds = clobTokenIds.split(',').map((s: string) => s.trim());
          }
        } else if (Array.isArray(clobTokenIds)) {
          tokenIds = clobTokenIds.map((x: unknown) => String(x));
        }
        upTokenId = tokenIds[0] || null;
        downTokenId = tokenIds[1] || null;
      }
      if (tokenIds.length >= 2) {
        const payload = tokenIds.slice(0, 2).map((id) => ({ token_id: id }));
        const midRes = await fetch(CLOB_MIDPOINTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (midRes.ok) {
          const midData = (await midRes.json()) as Record<string, unknown>;
          if (midData && !midData.error) {
            upMidPrice = parseMidpoint(midData[tokenIds[0]]);
            downMidPrice = parseMidpoint(midData[tokenIds[1]]);
          }
        }
      }
    } catch {
      // ignore
    }
    return { upMidPrice, downMidPrice, upTokenId, downTokenId };
  }
}
