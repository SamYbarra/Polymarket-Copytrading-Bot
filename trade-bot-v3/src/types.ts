/**
 * Core types for trade-bot-v3.
 */

export interface MarketInfo {
  conditionId: string;
  eventSlug: string;
  startTime: number;
  endTime: number;
}

export interface TokenQuote {
  bestBid: number;
  bestAsk: number;
  mid: number;
  ts: number;
}

export interface PositionState {
  conditionId: string;
  tokenId: string;
  outcome: "Up" | "Down";
  entryPrice: number;
  shares: number;
  remainingShares: number;
  entryTimeSec: number;
  /** True after we sold 50% at SELL_T1_PRICE. */
  t1Hit: boolean;
  /** True after we sold remaining at SELL_T2_PRICE. */
  t2Hit: boolean;
}
