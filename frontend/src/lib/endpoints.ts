/**
 * All API endpoints: frontend path/method and corresponding backend handler.
 * Base URL is appended at runtime (getApiBase()).
 */
export interface EndpointRow {
  method: string;
  path: string;
  query?: string[];
  description: string;
  backendHandler: string;
}

export const API_ENDPOINTS: EndpointRow[] = [
  {
    method: "GET",
    path: "/api/current-market-state",
    description: "Current 5m market, BTC open/current, up/down mid prices",
    backendHandler: "TrackerController.currentMarketState() → getCurrentMarketState()",
  },
  {
    method: "GET",
    path: "/api/current-market",
    description: "Current market + volume, wallet counts, top wallets",
    backendHandler: "TrackerController.currentMarket() → getCurrentMarket()",
  },
  {
    method: "GET",
    path: "/api/status",
    description: "Current market, Redis markets list, connection status",
    backendHandler: "TrackerController.status() → getStatus()",
  },
  {
    method: "GET",
    path: "/api/ml/current",
    description: "Current market’s ML prediction (if any)",
    backendHandler: "TrackerController.mlCurrent() → getMlCurrent()",
  },
  {
    method: "GET",
    path: "/api/wallet-stats",
    description: "Win/loss and win rate per wallet (top traders)",
    backendHandler: "TrackerController.walletStats() → getWalletStats()",
  },
  {
    method: "GET",
    path: "/api/predictions",
    query: ["includeResolved (true|false)", "limit (1–500, default 50)"],
    description: "Prediction history, optional filter by resolved",
    backendHandler: "TrackerController.predictions() → getPredictions()",
  },
  {
    method: "GET",
    path: "/api/prediction-accuracy",
    description: "Overall and recent-50 prediction accuracy",
    backendHandler: "TrackerController.predictionAccuracy() → getPredictionAccuracy()",
  },
  {
    method: "GET",
    path: "/api/results",
    query: ["eventSlug?", "conditionId?"],
    description: "Market results (resolution, profits)",
    backendHandler: "TrackerController.results() → getMarketResults()",
  },
  {
    method: "GET",
    path: "/api/redis-state",
    description: "Redis markets and wallet data (debug)",
    backendHandler: "TrackerController.redisState() → getRedisState()",
  },
  {
    method: "GET",
    path: "/api/wallet-balance",
    description: "CLOB balance/allowance (requires backend CLOB creds)",
    backendHandler: "TrackerController.walletBalance() → getWalletBalance()",
  },
  {
    method: "GET",
    path: "/api/my-orders",
    query: ["market (conditionId)"],
    description: "Open orders for a market (requires backend CLOB creds)",
    backendHandler: "TrackerController.myOrders() → getMyOrders()",
  },
  {
    method: "SSE",
    path: "/api/dashboard-stream",
    description: "Real-time dashboard payload (state, market, ml, walletBalance, myOrders)",
    backendHandler: "TrackerController.dashboardStream() → getDashboardStreamPayload()",
  },
];
