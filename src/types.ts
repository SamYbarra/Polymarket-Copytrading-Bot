/**
 * Types for Polymarket BTC 5m tracker
 */

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  startDate?: string;
  endDate?: string;
  markets?: Array<{
    id: string;
    conditionId?: string;
    eventStartTime?: string;
    startDate?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface DataApiTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  outcome?: string;
  outcomeIndex?: number;
  [key: string]: unknown;
}

export interface MarketInfo {
  conditionId: string;
  eventSlug: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
}

/** Trading state from Gamma API (event.markets[0]: bestBid, bestAsk, lastTradePrice, volume, etc.) */
export interface Btc5MarketTradingState {
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  volume: number | null;
  volume24hr: number | null;
  outcomePrices: [number, number] | null;
  spread: number | null;
  active: boolean | null;
  closed: boolean | null;
  /** CLOB token IDs [Up, Down] when available */
  upTokenId: string | null;
  downTokenId: string | null;
}

export interface WalletTradeData {
  wallet: string;
  totalBuyUsd: number;
  buyUpCount: number;
  buyDownCount: number;
  buyUpUsd: number;
  buyDownUsd: number;
  /** Unix timestamp of last buy (updated on each trade). */
  lastBuyTime?: number;
}

export interface CurrentHotWalletTradeData extends WalletTradeData {
  winRate: number;
  totalTrades: number;
}

export interface CurrentHotWalletSignal {
  conditionId: string;
  eventSlug: string;
  timestamp: number;
  predictedOutcome: "Up" | "Down" | "Neutral";
  confidence: number;
  upAverageScore: number;
  downAverageScore: number;
  upWalletCount: number;
  downWalletCount: number;
  upTotalVolume: number;
  downTotalVolume: number;
  upWallets: CurrentHotWalletTradeData[];
  downWallets: CurrentHotWalletTradeData[];
}

export interface MarketResult {
  conditionId: string;
  eventSlug: string;
  startTime: number;
  endTime: number;
  resolvedOutcome: "Up" | "Down" | null;
  profitableWallets: Array<{
    wallet: string;
    buyUpUsd: number;
    buyDownUsd: number;
    totalBuyUsd: number;
    profitUsd: number;
  }>;
  timestamp: number;
}

export interface WalletStatsDoc {
  wallet: string;
  winCount: number;
  loseCount: number;
  lastTradingTime: number;
}

export interface HotWallet {
  wallet: string;
  winRate: number;
  winCount: number;
  loseCount: number;
  totalTrades: number;
  recentTradingCount: number;
  avgProfitPerTrade: number;
  lastTradingTime: number;
  detectedAt: number;
}

export interface MarketFeatures {
  conditionId: string;
  eventSlug: string;
  timestamp: number;
  minutesElapsed: number;
  /** BTC price move since market open, in percent: 100 * (currentBtc - btcOpen) / btcOpen */
  btcDeltaPctAtPrediction: number;
  // Hot wallet features
  hotWalletUpVolume: number;
  hotWalletDownVolume: number;
  hotWalletImbalance: number;
  hotWalletCountUp: number;
  hotWalletCountDown: number;
  hotWalletAvgWinRateUp: number;
  hotWalletAvgWinRateDown: number;
  hotWalletTotalVolume: number;
  // Orderbook features
  orderbookImbalance: number;
  spreadRatio: number;
  liquidityRatio: number;
  // Volume features
  totalVolumeUp: number;
  totalVolumeDown: number;
  volumeRatio: number;
  tradeCountUp: number;
  tradeCountDown: number;
  largeTradeCountUp: number;
  largeTradeCountDown: number;
}

export interface MarketPrediction {
  conditionId: string;
  eventSlug: string;
  predictedOutcome: "Up" | "Down";
  confidence: number; // 0-1
  features: MarketFeatures;
  predictedAt: number;
  actualOutcome: "Up" | "Down" | null;
  isCorrect: boolean | null;
  accuracyUpdatedAt: number | null;
  /** True when we passed all buy checks and attempted a buy (set before calling buyWinToken). */
  wouldBuy?: boolean;
  /** True when we actually filled a buy for this prediction. */
  traded?: boolean;
  /** True when prediction came from ensemble fallback (ML service down/unused). */
  fromEnsemble?: boolean;
}

export interface MlBuyDoc {
  conditionId: string;
  eventSlug: string;
  predictedOutcome: "Up" | "Down";
  confidence: number;
  outcomePrice: number;
  shares: number;
  amountUsd: number;
  boughtAt: number;
  btcOpen?: number;
  currentBtc?: number;
  delta?: number;
}

export interface RedeemRecordDoc {
  conditionId: string;
  eventSlug: string | null;
  redeemedAt: number;
  tokensRedeemed: number;
  payoutUsd: number;
}
