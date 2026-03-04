/**
 * Core types for trade-bot-v4.
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
}
