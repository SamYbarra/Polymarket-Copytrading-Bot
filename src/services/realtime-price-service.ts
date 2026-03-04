/**
 * RealtimePriceService: WebSocket-based real-time Up/Down token prices.
 * Single source of truth for backend consumers. Falls back to HTTP when disconnected.
 */

import WebSocket from "ws";
import type { PolymarketClient, OrderBook } from "../clients/polymarket";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

const WS_URL =
  process.env.REALTIME_PRICE_WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const PING_INTERVAL_MS = parseInt(
  process.env.REALTIME_PRICE_PING_INTERVAL_MS || "10000",
  10
);
const PONG_TIMEOUT_MS = parseInt(process.env.REALTIME_PRICE_PONG_TIMEOUT_MS || "15000", 10);
const RECONNECT_INITIAL_MS = parseInt(process.env.REALTIME_PRICE_RECONNECT_INITIAL_MS || "1000", 10);
const RECONNECT_MAX_MS = parseInt(process.env.REALTIME_PRICE_RECONNECT_MAX_MS || "30000", 10);
const HTTP_POLL_INTERVAL_MS = parseInt(
  process.env.REALTIME_PRICE_HTTP_POLL_INTERVAL_MS || "2000",
  10
);
const CACHE_STALE_MS = parseInt(process.env.REALTIME_PRICE_CACHE_STALE_MS || "2000", 10);

export type RealtimePriceState = "IDLE" | "CONNECTING" | "SUBSCRIBED" | "DISCONNECTED";

interface CachedOrderBook {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  bestBid: number;
  bestAsk: number;
  mid: number;
  updatedAt: number;
}

export interface PriceResult {
  bestBid: number;
  bestAsk: number;
  mid: number;
}

export class RealtimePriceService {
  private polymarket: PolymarketClient;
  private state: RealtimePriceState = "IDLE";
  private ws: InstanceType<typeof WebSocket> | null = null;
  private currentConditionId: string | null = null;
  private upTokenId: string | null = null;
  private downTokenId: string | null = null;
  private cache = new Map<string, CachedOrderBook>();
  private inFlightFetches = new Map<string, Promise<OrderBook | null>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private httpPollTimer: ReturnType<typeof setInterval> | null = null;
  private httpFallbackLogAt = 0;

  constructor(polymarket: PolymarketClient) {
    this.polymarket = polymarket;
  }

  subscribe(conditionId: string, upTokenId: string, downTokenId: string): void {
    if (
      this.currentConditionId === conditionId &&
      this.upTokenId === upTokenId &&
      this.downTokenId === downTokenId
    ) {
      return;
    }

    this.unsubscribe(this.currentConditionId ?? "");

    this.currentConditionId = conditionId;
    this.upTokenId = upTokenId;
    this.downTokenId = downTokenId;
    this.cache.clear();

    console.log(`${ts()} 💵 Subscribe ${shortId(conditionId)}`);
    this.connect();
  }

  unsubscribe(conditionId: string): void {
    if (this.currentConditionId !== conditionId) return;

    this.state = "IDLE";
    this.currentConditionId = null;
    this.upTokenId = null;
    this.downTokenId = null;
    this.cache.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHttpPoll();
    this.closeWs();
    this.reconnectAttempt = 0;

    console.log(`${ts()} 💵 Unsubscribe ${shortId(conditionId)}`);
  }

  async getPrice(tokenId: string): Promise<PriceResult | null> {
    const ob = await this.getOrderBook(tokenId);
    if (!ob) return null;
    const cached = this.cache.get(tokenId);
    if (cached)
      return { bestBid: cached.bestBid, bestAsk: cached.bestAsk, mid: cached.mid };
    const bestBid = ob.bids.length ? parseFloat(ob.bids[0].price) : 0;
    const bestAsk = ob.asks.length ? parseFloat(ob.asks[0].price) : 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
    return { bestBid, bestAsk, mid };
  }

  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    const cached = this.cache.get(tokenId);
    const now = Date.now();
    const isStale = !cached || now - cached.updatedAt > CACHE_STALE_MS;

    if (this.state === "SUBSCRIBED" && cached && !isStale) {
      return { bids: cached.bids, asks: cached.asks };
    }

    if (this.state === "DISCONNECTED" || this.state === "IDLE" || isStale) {
      return this.fetchAndCache(tokenId);
    }

    return cached ? { bids: cached.bids, asks: cached.asks } : null;
  }

  isConnected(): boolean {
    return this.state === "SUBSCRIBED";
  }

  getState(): RealtimePriceState {
    return this.state;
  }

  shutdown(): void {
    this.unsubscribe(this.currentConditionId ?? "");
  }

  private connect(): void {
    if (this.state === "IDLE" || !this.upTokenId || !this.downTokenId) return;

    this.state = "CONNECTING";
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn(`${ts()} ⚠ Price WS connect failed`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.lastPongAt = Date.now();
      this.ws!.send(
        JSON.stringify({
          assets_ids: [this.upTokenId, this.downTokenId],
          type: "market",
          custom_feature_enabled: true,
        })
      );
      this.state = "SUBSCRIBED";
      this.reconnectAttempt = 0;
      this.stopHttpPoll();
      console.log(`${ts()} 🔗 Price WS`);

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);

      this.pongCheckInterval = setInterval(() => {
        if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
          console.warn(`${ts()} ⚠ Price WS pong timeout`);
          this.closeWs();
        }
      }, 2000);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "pong") {
          this.lastPongAt = Date.now();
          return;
        }
        const eventType = data.event_type;
        const aid = data.asset_id != null ? String(data.asset_id) : null;

        if (eventType === "book" && aid) {
          const bids = data.bids || [];
          const asks = data.asks || [];
          const bestBid = bids[0] ? parseFloat(bids[0].price) : 0;
          const bestAsk = asks[0] ? parseFloat(asks[0].price) : 0;
          const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
          this.cache.set(aid, { bids, asks, bestBid, bestAsk, mid, updatedAt: Date.now() });
        } else if (eventType === "best_bid_ask" && aid) {
          const bestBid = parseFloat(data.best_bid ?? 0) || 0;
          const bestAsk = parseFloat(data.best_ask ?? 0) || 0;
          const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
          const existing = this.cache.get(aid);
          this.cache.set(aid, {
            bids: existing?.bids ?? [],
            asks: existing?.asks ?? [],
            bestBid,
            bestAsk,
            mid,
            updatedAt: Date.now(),
          });
        } else if (eventType === "price_change" && Array.isArray(data.price_changes)) {
          for (const pc of data.price_changes) {
            const pcAid = pc.asset_id != null ? String(pc.asset_id) : null;
            if (!pcAid) continue;
            const bestBid = parseFloat(pc.best_bid ?? 0) || 0;
            const bestAsk = parseFloat(pc.best_ask ?? 0) || 0;
            const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
            const existing = this.cache.get(pcAid);
            this.cache.set(pcAid, {
              bids: existing?.bids ?? [],
              asks: existing?.asks ?? [],
              bestBid,
              bestAsk,
              mid,
              updatedAt: Date.now(),
            });
          }
        }
      } catch (_) {}
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    this.closeWs();
    if (this.state === "IDLE") return;

    this.state = "DISCONNECTED";
    console.warn(`${ts()} ⚠ Price WS disconnected`);

    this.startHttpPoll();
    this.scheduleReconnect();
  }

  private closeWs(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongCheckInterval) {
      clearInterval(this.pongCheckInterval);
      this.pongCheckInterval = null;
    }
    if (this.ws) {
      this.ws.onopen = () => {};
      this.ws.onmessage = () => {};
      this.ws.onclose = () => {};
      this.ws.onerror = () => {};
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.state === "IDLE" || this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;

    console.log(`${ts()} ℹ Price WS reconnect #${this.reconnectAttempt} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.state === "IDLE") return;
      this.connect();
    }, delay);
  }

  private startHttpPoll(): void {
    if (this.httpPollTimer || !this.upTokenId || !this.downTokenId) return;

    const poll = async () => {
      if (this.state !== "DISCONNECTED" || !this.upTokenId || !this.downTokenId) return;

      const now = Date.now();
      if (now - this.httpFallbackLogAt > 60_000) {
        console.log(`${ts()} ℹ Price: using HTTP fallback`);
        this.httpFallbackLogAt = now;
      }

      try {
        const [upBook, downBook] = await Promise.all([
          this.polymarket.getOrderBook(this.upTokenId),
          this.polymarket.getOrderBook(this.downTokenId),
        ]);
        if (upBook) this.updateCacheFromBook(this.upTokenId, upBook);
        if (downBook) this.updateCacheFromBook(this.downTokenId, downBook);
      } catch (_) {}
    };

    poll();
    this.httpPollTimer = setInterval(poll, HTTP_POLL_INTERVAL_MS);
  }

  private stopHttpPoll(): void {
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
  }

  private updateCacheFromBook(tokenId: string, book: OrderBook): void {
    const bestBid = book.bids.length ? parseFloat(book.bids[0].price) : 0;
    const bestAsk = book.asks.length ? parseFloat(book.asks[0].price) : 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
    this.cache.set(tokenId, {
      bids: book.bids,
      asks: book.asks,
      bestBid,
      bestAsk,
      mid,
      updatedAt: Date.now(),
    });
  }

  private async fetchAndCache(tokenId: string): Promise<OrderBook | null> {
    let p = this.inFlightFetches.get(tokenId);
    if (!p) {
      p = this.polymarket
        .getOrderBook(tokenId)
        .finally(() => this.inFlightFetches.delete(tokenId));
      this.inFlightFetches.set(tokenId, p);
    }
    const book = await p;
    if (book) this.updateCacheFromBook(tokenId, book);
    return book;
  }
}
