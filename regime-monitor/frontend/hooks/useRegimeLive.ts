"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_REGIME_API || "http://localhost:8006";
const WS_URL = (() => {
  if (typeof window === "undefined") return "";
  const u = new URL(API_BASE);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/regime";
  return u.toString();
})();

export interface RegimeCurrent {
  timestamp: string;
  regime_score: number;
  vol_ratio: number;
  kelly_multiplier: number;
  threshold_multiplier: number;
  shrink_multiplier: number;
  momentum_weight_adj?: number;
  classification: string;
  rv_short?: number;
  rv_long?: number;
  range_expansion?: number;
  vol_accel?: number;
}

export interface RegimeHistoryPoint {
  timestamp: string;
  vol_ratio: number;
  regime_score: number;
  kelly_multiplier: number;
  threshold_multiplier: number;
  shrink_multiplier: number;
  rv_short: number;
  rv_long: number;
  range_expansion: number;
  vol_accel: number;
}

export function useRegimeLive(hours = 24) {
  const [current, setCurrent] = useState<RegimeCurrent | null>(null);
  const [history, setHistory] = useState<RegimeHistoryPoint[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          setTimeout(connect, 3000);
        };
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data as string) as RegimeCurrent;
            setCurrent(data);
          } catch {}
        };
        ws.onerror = () => {};
      } catch {
        setConnected(false);
      }
    }

    connect();

    async function fetchHistory() {
      try {
        const res = await fetch(`${API_BASE}/regime/history?hours=${hours}`);
        if (res.ok) {
          const data = (await res.json()) as RegimeHistoryPoint[];
          setHistory(data);
        }
      } catch {}
    }

    fetchHistory();
    interval = setInterval(fetchHistory, 10_000);

    return () => {
      if (ws) ws.close();
      if (interval) clearInterval(interval);
    };
  }, [hours]);

  useEffect(() => {
    if (!current) return;
    setHistory((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      const ts = current.timestamp;
      if (!last || last.timestamp !== ts) {
        next.push({
          timestamp: ts,
          vol_ratio: current.vol_ratio,
          regime_score: current.regime_score,
          kelly_multiplier: current.kelly_multiplier,
          threshold_multiplier: current.threshold_multiplier,
          shrink_multiplier: current.shrink_multiplier,
          rv_short: current.rv_short ?? 0,
          rv_long: current.rv_long ?? 0,
          range_expansion: current.range_expansion ?? 0,
          vol_accel: current.vol_accel ?? 0,
        });
        const maxPoints = Math.max(200, hours * 120);
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
      } else {
        next[next.length - 1] = {
          ...last,
          vol_ratio: current.vol_ratio,
          regime_score: current.regime_score,
          kelly_multiplier: current.kelly_multiplier,
          threshold_multiplier: current.threshold_multiplier,
          shrink_multiplier: current.shrink_multiplier,
          rv_short: current.rv_short ?? last.rv_short,
          rv_long: current.rv_long ?? last.rv_long,
          range_expansion: current.range_expansion ?? last.range_expansion,
          vol_accel: current.vol_accel ?? last.vol_accel,
        };
      }
      return next;
    });
  }, [current, hours]);

  return { current, history, connected };
}
