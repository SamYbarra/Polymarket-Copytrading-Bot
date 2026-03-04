/**
 * Client for NestJS backend. Uses VITE_API_URL if set; otherwise same host as the
 * page on port 3006 (avoids CORS / private-network when visiting via public IP).
 */
function getBase(): string {
  const env = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3006`;
  }
  return "http://localhost:3006";
}
const BASE = getBase();

/** Base API URL (for displaying endpoint in UI). */
export function getApiBase(): string {
  return BASE;
}

/** SSE URL for real-time dashboard updates (used with EventSource). */
export function getDashboardStreamUrl(): string {
  return `${BASE}/api/dashboard-stream`;
}

async function get<T>(path: string, search?: Record<string, string>): Promise<T> {
  const url = search
    ? `${BASE}${path}?${new URLSearchParams(search).toString()}`
    : `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  currentMarketState: () =>
    get<import("./types").CurrentMarketStateResponse>("/api/current-market-state"),
  currentMarket: () =>
    get<import("./types").CurrentMarketResponse>("/api/current-market"),
  status: () => get<import("./types").StatusResponse>("/api/status"),
  mlCurrent: () => get<import("./types").MlCurrentResponse>("/api/ml/current"),
  walletStats: () => get<import("./types").WalletStatsResponse>("/api/wallet-stats"),
  predictions: (includeResolved = true, limit = 50) =>
    get<import("./types").Prediction[]>("/api/predictions", {
      includeResolved: String(includeResolved),
      limit: String(limit),
    }),
  predictionAccuracy: () =>
    get<import("./types").PredictionAccuracyResponse>("/api/prediction-accuracy"),
  results: (params?: { eventSlug?: string; conditionId?: string }) => {
    const search: Record<string, string> = {};
    if (params?.eventSlug) search.eventSlug = params.eventSlug;
    if (params?.conditionId) search.conditionId = params.conditionId;
    return get<import("./types").MarketResult[]>(
      "/api/results",
      Object.keys(search).length ? search : undefined
    );
  },
};
