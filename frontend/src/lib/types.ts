/** API response types matching backend server. */

export interface CurrentMarketInfo {
  conditionId: string;
  eventSlug: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  secondsLeft?: number;
  upTokenId?: string | null;
  downTokenId?: string | null;
}

export interface CurrentMarketStateResponse {
  currentMarket: CurrentMarketInfo | null;
  btcOpenPrice: number | null;
  currentBtcPrice: number | null;
  upMidPrice: number | null;
  downMidPrice: number | null;
  message?: string;
}

export interface CurrentMarketWallet {
  wallet: string;
  up: number;
  down: number;
  buyTime: number | null;
}

export interface CurrentMarketResponse {
  currentMarket: CurrentMarketInfo | null;
  totalAmount: number;
  totalWalletCount: number;
  totalUp: number;
  totalDown: number;
  wallets: CurrentMarketWallet[];
}

export interface StatusResponse {
  currentMarket: CurrentMarketInfo | null;
  redisMarkets: { conditionId: string; walletCount: number; totalUsd: number }[];
  redisConnected: boolean;
}

export interface WalletStat {
  wallet: string;
  winCount: number;
  loseCount: number;
  winRate: number;
  lastTradingTime: number | null;
}

export interface WalletStatsResponse {
  count: number;
  wallets: WalletStat[];
}

export interface Prediction {
  conditionId: string;
  eventSlug?: string;
  predictedOutcome: "Up" | "Down";
  confidence: number;
  predictedAt: number;
  actualOutcome?: "Up" | "Down" | null;
  isCorrect?: boolean | null;
  wouldBuy?: boolean;
  traded?: boolean;
}

export interface PredictionAccuracyResponse {
  overall: { total: number; correct: number; incorrect: number; accuracy: number };
  recent50: { total: number; correct: number; incorrect: number; accuracy: number };
}

export interface MlCurrentResponse {
  hasPrediction: boolean;
  currentMarket?: CurrentMarketInfo;
  prediction?: {
    predictedOutcome: string;
    confidence: number;
    probUp: number;
    probDown: number;
    predictedAt: number;
    actualOutcome?: string | null;
    isCorrect?: boolean | null;
    wouldBuy?: boolean;
    traded?: boolean;
  };
  message?: string;
}

export interface MarketResult {
  conditionId: string;
  eventSlug?: string;
  outcome?: "Up" | "Down";
  [key: string]: unknown;
}

export interface WalletBalanceResponse {
  balanceUsd: number;
  allowanceUsd: number;
  availableUsd: number;
}

export interface MyOrder {
  id: string;
  side: string;
  outcome: string;
  price: number;
  size: number;
  sizeMatched: number;
  amountUsd: number;
  createdAt: number;
}
