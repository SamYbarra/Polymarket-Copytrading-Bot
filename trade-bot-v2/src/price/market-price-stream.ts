/**
 * Realtime market price layer: WebSocket, top-of-book only (best bid/ask).
 * Auto-reconnects on close/error with exponential backoff. Stale data avoided by
 * treating quotes older than STALE_MS as invalid when disconnected.
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
/** Quote older than this (and we're disconnected) is treated as stale — return null. */
const STALE_MS = 30_000;
/** How often to check if we've reached market end time (open + 5min) and should switch. */
const MARKET_SWITCH_CHECK_MS = 1000;

export interface MarketSwitchOptions {
  /** Market end time (UTC): market open time + 5 min. When now >= this, stream switches automatically. */
  marketEndTimeSec: number;
  /** Called when end time reached; return next market token IDs and its end time (open+5min), or null. */
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
  /** When true, close/error handlers must not schedule reconnect (we're switching market). */
  private closingForMarketSwitch = false;

  /** Subscribe to tokens. Closes existing WS (unsub old), opens new WS and sends assets_ids (sub new). */
  subscribe(assetIds: string[], options?: MarketSwitchOptions): void {
    this.tokenIds = [...assetIds];
    this.cache.clear();
    console.error(`[MarketPriceStream] subscribe: close old WebSocket, reconnect with new tokenIds (count=${this.tokenIds.length})`);
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
    const nowSec = Math.floor(Date.now() / 1000);
    if (this.onMarketClosed != null && this.marketEndTimeSec > 0) {
      this.marketSwitchTimerId = setInterval(() => this.checkMarketClosed(), MARKET_SWITCH_CHECK_MS);
      console.error(
        `[MarketPriceStream] switch timer started endTime=${this.marketEndTimeSec} (switch in ${this.marketEndTimeSec - nowSec}s)`
      );
    } else {
      console.error(
        `[MarketPriceStream] switch timer NOT started onMarketClosed=${!!this.onMarketClosed} marketEndTimeSec=${this.marketEndTimeSec}`
      );
    }

    this.connect();
  }

  /** When now >= marketEndTimeSec (open+5min), get next market from callback and switch. */
  private async checkMarketClosed(): Promise<void> {
    if (this.isShutdown || this.switchingMarket || !this.onMarketClosed || this.marketEndTimeSec <= 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < this.marketEndTimeSec) return;
    console.error(`[MarketPriceStream] end time reached now=${nowSec} end=${this.marketEndTimeSec}, calling onMarketClosed`);
    this.switchingMarket = true;
    try {
      const next = await this.onMarketClosed();
      if (!next?.tokenIds?.length) {
        console.error(`[MarketPriceStream] onMarketClosed returned no next market, will retry next tick`);
        this.switchingMarket = false;
        return;
      }
      // Cancel any pending reconnect so it doesn't overwrite our new connection
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
      console.error(`[MarketPriceStream] unsub old WS, sub new tokenIds (count=${this.tokenIds.length}) endTime=${this.marketEndTimeSec}`);
      this.connect();
    } catch (e) {
      console.error("[MarketPriceStream] onMarketClosed failed", e);
    } finally {
      this.switchingMarket = false;
      this.closingForMarketSwitch = false;
    }
  }

  /** True if WebSocket is open. */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Get latest quote (from WS cache). Returns null if disconnected and quote is stale. */
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

  /** Wait until WS is open and subscribed. */
  async whenReady(): Promise<void> {
    return this.ready;
  }

  private scheduleReconnect(): void {
    if (this.isShutdown || this.tokenIds.length === 0) return;
    if (this.reconnectTimerId) return;
    const delay = Math.min(
      RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    this.reconnectTimerId = setTimeout(() => {
      this.reconnectTimerId = null;
      this.connect();
    }, delay);
    console.error(
      `[MarketPriceStream] reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})`
    );
  }

  private connect(): void {
    this.close();
    if (this.isShutdown) return;
    this.ws = new WebSocket(WS_URL);
    this.ws.on("open", () => {
      this.lastPong = Date.now();
      this.reconnectAttempts = 0;
      this.ws!.send(
        JSON.stringify({
          assets_ids: this.tokenIds,
          type: "market",
          custom_feature_enabled: true,
        })
      );
      this.resolveReady?.();
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN)
          this.ws.send(JSON.stringify({ type: "ping" }));
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
          for (const pc of msg.price_changes as Array<{
            asset_id?: string;
            best_bid?: number;
            best_ask?: number;
          }>) {
            const aid = pc.asset_id != null ? String(pc.asset_id) : null;
            if (!aid) continue;
            const bestBid = Number(pc.best_bid ?? 0) || 0;
            const bestAsk = Number(pc.best_ask ?? 0) || 0;
            const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid;
            this.cache.set(aid, { bestBid, bestAsk, mid, ts: Date.now() });
          }
        }
      } catch {
        // skip parse errors
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

  /** @param forMarketSwitch if true, only close the socket; handlers will clean up and not reconnect */
  private close(forMarketSwitch?: boolean): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.pongTimer) clearInterval(this.pongTimer);
    this.pongTimer = null;
    if (this.ws) {
      if (forMarketSwitch) {
        this.ws.close();
        // leave ws and listeners so "close" handler can run and skip scheduleReconnect
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
