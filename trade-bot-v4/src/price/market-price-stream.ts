/**
 * Realtime market price: WebSocket, best bid/ask. Same pattern as v3.
 */

import WebSocket from "ws";
import { config } from "../config";
import type { TokenQuote } from "../types";

const WS_URL = config.WS_URL;
const PING_MS = config.PING_MS;
const PONG_TIMEOUT_MS = config.PONG_TIMEOUT_MS;
const RECONNECT_INITIAL_MS = config.WS_RECONNECT_INITIAL_MS;
const RECONNECT_MAX_MS = config.WS_RECONNECT_MAX_MS;
const PONG_CHECK_MS = config.WS_PONG_CHECK_MS;
const STALE_MS = 30_000;
const MARKET_SWITCH_CHECK_MS = 1000;

export interface MarketSwitchOptions {
  marketEndTimeSec: number;
  onMarketClosed: () => Promise<{ tokenIds: string[]; marketEndTimeSec: number } | null>;
}

export class MarketPriceStream {
  private ws: WebSocket | null = null;
  private tokenIds: string[] = [];
  private cache = new Map<string, TokenQuote>();
  private lastPong = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setInterval> | null = null;
  private resolveReady: (() => void) | null = null;
  private ready = new Promise<void>((r) => { this.resolveReady = r; });
  private isShutdown = false;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private marketEndTimeSec = 0;
  private onMarketClosed: MarketSwitchOptions["onMarketClosed"] | null = null;
  private marketSwitchTimerId: ReturnType<typeof setInterval> | null = null;
  private switchingMarket = false;
  private closingForMarketSwitch = false;

  subscribe(assetIds: string[], options?: MarketSwitchOptions): void {
    this.tokenIds = [...assetIds];
    this.cache.clear();
    if (this.reconnectTimerId) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
    this.reconnectAttempts = 0;
    if (this.marketSwitchTimerId) {
      clearInterval(this.marketSwitchTimerId);
      this.marketSwitchTimerId = null;
    }
    this.marketEndTimeSec = options?.marketEndTimeSec ?? 0;
    this.onMarketClosed = options?.onMarketClosed ?? null;
    if (this.onMarketClosed != null && this.marketEndTimeSec > 0) {
      this.marketSwitchTimerId = setInterval(() => this.checkMarketClosed(), MARKET_SWITCH_CHECK_MS);
    }
    this.connect();
  }

  private async checkMarketClosed(): Promise<void> {
    if (this.isShutdown || this.switchingMarket || !this.onMarketClosed || this.marketEndTimeSec <= 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < this.marketEndTimeSec) return;
    this.switchingMarket = true;
    try {
      const next = await this.onMarketClosed();
      if (!next?.tokenIds?.length) {
        this.switchingMarket = false;
        return;
      }
      if (this.reconnectTimerId) {
        clearTimeout(this.reconnectTimerId);
        this.reconnectTimerId = null;
      }
      this.reconnectAttempts = 0;
      this.tokenIds = [...next.tokenIds];
      this.marketEndTimeSec = next.marketEndTimeSec;
      this.cache.clear();
      this.closingForMarketSwitch = true;
      this.close(true);
      this.connect();
    } catch {
      // ignore
    } finally {
      this.switchingMarket = false;
      this.closingForMarketSwitch = false;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getQuote(tokenId: string): TokenQuote | null {
    const q = this.cache.get(tokenId) ?? null;
    if (!q) return null;
    if (!this.isConnected() && Date.now() - q.ts > STALE_MS) return null;
    return q;
  }

  getBestAsk(tokenId: string): number | null {
    const q = this.getQuote(tokenId);
    return q && q.bestAsk > 0 ? q.bestAsk : null;
  }

  getBestBid(tokenId: string): number | null {
    const q = this.getQuote(tokenId);
    return q && q.bestBid > 0 ? q.bestBid : null;
  }

  getMid(tokenId: string): number | null {
    const q = this.getQuote(tokenId);
    return q ? q.mid : null;
  }

  async whenReady(): Promise<void> {
    return this.ready;
  }

  private scheduleReconnect(): void {
    if (this.isShutdown || this.tokenIds.length === 0) return;
    if (this.reconnectTimerId) return;
    const delay = Math.min(RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.reconnectTimerId = setTimeout(() => {
      this.reconnectTimerId = null;
      this.connect();
    }, delay);
  }

  private connect(): void {
    this.close();
    if (this.isShutdown) return;
    this.ws = new WebSocket(WS_URL);
    this.ws.on("open", () => {
      this.lastPong = Date.now();
      this.reconnectAttempts = 0;
      this.ws!.send(JSON.stringify({ assets_ids: this.tokenIds, type: "market", custom_feature_enabled: true }));
      this.resolveReady?.();
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping" }));
      }, PING_MS);
      this.pongTimer = setInterval(() => {
        if (Date.now() - this.lastPong > PONG_TIMEOUT_MS) {
          this.close();
          this.scheduleReconnect();
        }
      }, PONG_CHECK_MS);
    });
    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "pong") {
          this.lastPong = Date.now();
          return;
        }
        const eventType = msg.event_type as string | undefined;
        const assetId = msg.asset_id != null ? String(msg.asset_id) : null;
        if (!assetId) return;
        if (eventType === "best_bid_ask") {
          const bestBid = parseFloat(String(msg.best_bid ?? 0)) || 0;
          const bestAsk = parseFloat(String(msg.best_ask ?? 0)) || 0;
          const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid;
          this.cache.set(assetId, { bestBid, bestAsk, mid, ts: Date.now() });
          return;
        }
        if (eventType === "price_change" && Array.isArray(msg.price_changes)) {
          for (const pc of msg.price_changes as Array<{ asset_id?: string; best_bid?: number; best_ask?: number }>) {
            const aid = pc.asset_id != null ? String(pc.asset_id) : null;
            if (!aid) continue;
            const bestBid = Number(pc.best_bid ?? 0) || 0;
            const bestAsk = Number(pc.best_ask ?? 0) || 0;
            const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid;
            this.cache.set(aid, { bestBid, bestAsk, mid, ts: Date.now() });
          }
        }
      } catch {
        // skip
      }
    });
    this.ws.on("close", () => {
      if (this.closingForMarketSwitch) {
        const sock = this.ws;
        if (sock) {
          sock.removeAllListeners();
          if (this.ws === sock) this.ws = null;
        }
        return;
      }
      this.close();
      this.scheduleReconnect();
    });
    this.ws.on("error", () => {
      if (this.closingForMarketSwitch) return;
      this.close();
      this.scheduleReconnect();
    });
  }

  private close(forMarketSwitch?: boolean): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.pongTimer) clearInterval(this.pongTimer);
    this.pongTimer = null;
    if (this.ws) {
      if (forMarketSwitch) {
        this.ws.close();
      } else {
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = null;
      }
    }
  }

  shutdown(): void {
    this.isShutdown = true;
    if (this.reconnectTimerId) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
    if (this.marketSwitchTimerId) {
      clearInterval(this.marketSwitchTimerId);
      this.marketSwitchTimerId = null;
    }
    this.onMarketClosed = null;
    this.close();
  }
}
