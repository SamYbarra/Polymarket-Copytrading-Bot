/**
 * Monitor token prices for the current open Bitcoin 5m market via CLOB WebSocket.
 * Standalone script: npx ts-node src/scripts/monitor-token-price-ws.ts
 * Env: REALTIME_PRICE_WS_URL, MONITOR_OUTPUT_JSON, MARKET_SLUG_PREFIX, MARKET_WINDOW_MINUTES
 */

import "dotenv/config";
import WebSocket from "ws";
import { SLUG_PREFIX, getCurrentWindowTs } from "../config/market";
import { realtimePriceEnv } from "../config/env";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const OUTPUT_JSON = process.env.MONITOR_OUTPUT_JSON === "1" || process.env.MONITOR_OUTPUT_JSON === "true";
const WINDOW_CHECK_MS = parseInt(process.env.MONITOR_WS_WINDOW_CHECK_MS || "5000", 10);

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const GAMMA_FETCH_TIMEOUT_MS = 10000;
const GAMMA_FETCH_RETRIES = 3;
const GAMMA_FETCH_RETRY_DELAY_MS = 1000;

async function getTokenIdsForSlug(slug: string): Promise<{
  upTokenId: string | null;
  downTokenId: string | null;
  conditionId: string | null;
} | null> {
  const url = `${GAMMA_API_BASE}/markets/slug/${encodeURIComponent(slug)}`;
  const opts: RequestInit = {
    headers: { Accept: "application/json", "User-Agent": "PolymarketBTC5MonitorWS/1.0" },
    signal: AbortSignal.timeout(GAMMA_FETCH_TIMEOUT_MS),
  };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= GAMMA_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) return null;
      const data = (await res.json()) as { outcomes?: unknown; clobTokenIds?: unknown; conditionId?: string };
      const outcomes = parseJsonArray<string>(data.outcomes);
      const tokenIds = parseJsonArray<string>(data.clobTokenIds);
      const conditionId = typeof data.conditionId === "string" ? data.conditionId : null;
      const upIdx = outcomes.indexOf("Up");
      const downIdx = outcomes.indexOf("Down");
      if (upIdx < 0 || downIdx < 0 || !tokenIds[upIdx] || !tokenIds[downIdx]) return null;
      return {
        upTokenId: tokenIds[upIdx],
        downTokenId: tokenIds[downIdx],
        conditionId,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < GAMMA_FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, GAMMA_FETCH_RETRY_DELAY_MS));
      }
    }
  }
  if (!OUTPUT_JSON) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.error(`[${new Date().toISOString()}] Gamma fetch failed for ${slug}: ${msg.slice(0, 60)}`);
  }
  return null;
}

function formatPrice(p: number | null): string {
  if (p == null) return " — ";
  return p.toFixed(3);
}

function bestBidAskFromLevels(
  bids: Array<{ price: string; size: string }>,
  asks: Array<{ price: string; size: string }>
): { bid: number | null; ask: number | null } {
  let bid: number | null = null;
  let ask: number | null = null;
  for (const level of bids) {
    const p = parseFloat(level.price);
    if (Number.isFinite(p)) bid = bid == null ? p : Math.max(bid, p);
  }
  for (const level of asks) {
    const p = parseFloat(level.price);
    if (Number.isFinite(p)) ask = ask == null ? p : Math.min(ask, p);
  }
  return { bid, ask };
}

function emitLine(
  slug: string,
  conditionId: string,
  upTokenId: string,
  downTokenId: string,
  upBid: number | null,
  upAsk: number | null,
  downBid: number | null,
  downAsk: number | null
): void {
  const time = new Date().toISOString();
  if (OUTPUT_JSON) {
    console.log(
      JSON.stringify({
        conditionId,
        slug,
        upTokenId,
        downTokenId,
        upBid,
        upAsk,
        downBid,
        downAsk,
        ts: time,
      })
    );
  } else {
    const line = `[${time}] ${slug}  |  UP   bid ${formatPrice(upBid)} ask ${formatPrice(upAsk)}  |  DOWN bid ${formatPrice(downBid)} ask ${formatPrice(downAsk)}`;
    console.log(line);
  }
}

interface TokenPrices {
  bid: number | null;
  ask: number | null;
}

async function main(): Promise<void> {
  const wsUrl = realtimePriceEnv.WS_URL;
  const pingIntervalMs = realtimePriceEnv.PING_INTERVAL_MS;
  const pongTimeoutMs = realtimePriceEnv.PONG_TIMEOUT_MS;
  const reconnectInitialMs = realtimePriceEnv.RECONNECT_INITIAL_MS;
  const reconnectMaxMs = realtimePriceEnv.RECONNECT_MAX_MS;

  let ws: InstanceType<typeof WebSocket> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongCheckTimer: ReturnType<typeof setInterval> | null = null;
  let windowCheckTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let lastPongAt = 0;

  let currentSlug: string | null = null;
  let currentConditionId: string | null = null;
  let currentUpTokenId: string | null = null;
  let currentDownTokenId: string | null = null;
  const prices = new Map<string, TokenPrices>();

  function clearTimers(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongCheckTimer) {
      clearInterval(pongCheckTimer);
      pongCheckTimer = null;
    }
    if (windowCheckTimer) {
      clearInterval(windowCheckTimer);
      windowCheckTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeWs(): void {
    clearTimers();
    if (ws) {
      ws.removeAllListeners();
      ws.close();
      ws = null;
    }
  }

  function emitCurrent(): void {
    if (
      !currentSlug ||
      !currentConditionId ||
      !currentUpTokenId ||
      !currentDownTokenId
    )
      return;
    const up = prices.get(currentUpTokenId) ?? { bid: null, ask: null };
    const down = prices.get(currentDownTokenId) ?? { bid: null, ask: null };
    emitLine(
      currentSlug,
      currentConditionId,
      currentUpTokenId,
      currentDownTokenId,
      up.bid,
      up.ask,
      down.bid,
      down.ask
    );
  }

  function onMessage(data: Buffer | string): void {
    try {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === "pong") {
        lastPongAt = Date.now();
        return;
      }

      const eventType = msg.event_type as string | undefined;
      const assetId = msg.asset_id != null ? String(msg.asset_id) : null;

      if (eventType === "book" && assetId) {
        const bids = (msg.bids as Array<{ price: string; size: string }>) ?? [];
        const asks = (msg.asks as Array<{ price: string; size: string }>) ?? [];
        const { bid, ask } = bestBidAskFromLevels(bids, asks);
        prices.set(assetId, { bid, ask });
        emitCurrent();
      } else if (eventType === "best_bid_ask" && assetId) {
        const bid = msg.best_bid != null ? parseFloat(String(msg.best_bid)) : null;
        const ask = msg.best_ask != null ? parseFloat(String(msg.best_ask)) : null;
        const existing = prices.get(assetId) ?? { bid: null, ask: null };
        prices.set(assetId, {
          bid: Number.isFinite(bid) ? bid : existing.bid,
          ask: Number.isFinite(ask) ? ask : existing.ask,
        });
        emitCurrent();
      } else if (eventType === "price_change" && Array.isArray(msg.price_changes)) {
        for (const pc of msg.price_changes as Array<{ asset_id?: string; best_bid?: number; best_ask?: number }>) {
          const aid = pc.asset_id != null ? String(pc.asset_id) : null;
          if (!aid) continue;
          const bid = pc.best_bid != null ? Number(pc.best_bid) : null;
          const ask = pc.best_ask != null ? Number(pc.best_ask) : null;
          const existing = prices.get(aid) ?? { bid: null, ask: null };
          prices.set(aid, {
            bid: Number.isFinite(bid) ? bid : existing.bid,
            ask: Number.isFinite(ask) ? ask : existing.ask,
          });
        }
        emitCurrent();
      }
    } catch (_) {
      // skip parse errors
    }
  }

  async function subscribeToCurrentWindow(): Promise<boolean> {
    const ts = getCurrentWindowTs();
    const slug = `${SLUG_PREFIX}${ts}`;
    const tokenData = await getTokenIdsForSlug(slug);
    if (!tokenData?.upTokenId || !tokenData.downTokenId || !tokenData.conditionId) {
      if (!OUTPUT_JSON) {
        console.error(`[${new Date().toISOString()}] No market or token IDs for slug ${slug}`);
      }
      return false;
    }

    const isNewMarket =
      currentSlug !== slug ||
      currentConditionId !== tokenData.conditionId;

    currentSlug = slug;
    currentConditionId = tokenData.conditionId;
    currentUpTokenId = tokenData.upTokenId;
    currentDownTokenId = tokenData.downTokenId;
    prices.set(tokenData.upTokenId, { bid: null, ask: null });
    prices.set(tokenData.downTokenId, { bid: null, ask: null });

    if (isNewMarket && !OUTPUT_JSON) {
      console.log(
        `[${new Date().toISOString()}] Market switched to ${slug} (conditionId: ${tokenData.conditionId.slice(0, 18)}…)`
      );
    }

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          assets_ids: [tokenData.upTokenId, tokenData.downTokenId],
          type: "market",
          custom_feature_enabled: true,
        })
      );
    }
    return true;
  }

  function connect(): void {
    closeWs();
    ws = new WebSocket(wsUrl);

    ws.on("open", async () => {
      lastPongAt = Date.now();
      reconnectAttempt = 0;
      const ok = await subscribeToCurrentWindow();
      if (!ok) return;

      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, pingIntervalMs);

      pongCheckTimer = setInterval(() => {
        if (Date.now() - lastPongAt > pongTimeoutMs) {
          if (!OUTPUT_JSON) console.error(`[${new Date().toISOString()}] WebSocket pong timeout`);
          closeWs();
          scheduleReconnect();
        }
      }, 2000);

      windowCheckTimer = setInterval(async () => {
        const ts = getCurrentWindowTs();
        const slug = `${SLUG_PREFIX}${ts}`;
        if (slug === currentSlug) return;
        await subscribeToCurrentWindow();
      }, WINDOW_CHECK_MS);

      if (!OUTPUT_JSON) {
        console.log(`BTC 5m token price monitor (WebSocket). Slug prefix: ${SLUG_PREFIX}. Ctrl+C to stop.`);
      }
    });

    ws.on("message", onMessage);

    ws.on("close", () => {
      closeWs();
      scheduleReconnect();
    });

    ws.on("error", () => {
      closeWs();
      scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(
      reconnectInitialMs * Math.pow(2, reconnectAttempt),
      reconnectMaxMs
    );
    reconnectAttempt++;
    if (!OUTPUT_JSON) {
      console.error(`[${new Date().toISOString()}] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})…`);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  process.on("SIGINT", () => {
    closeWs();
    process.exit(0);
  });

  connect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
