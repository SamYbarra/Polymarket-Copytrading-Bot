/**
 * Core types. No dependency on parent src.
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
  /** Token ID for this outcome (needed to sell after market switch). */
  tokenId: string;
  outcome: "Up" | "Down";
  entryPrice: number;
  confidence: number;
  shares: number;
  remainingShares: number;
  entryTimeSec: number;
  t1Hit: boolean;
  t2Hit: boolean;
  highWaterMark: number;
  /** Limit sell order ID (e.g. @ 0.97); cancelled when profit lock sells. */
  limitOrderId?: string;
}

export type SignalType = "none" | "buy" | "sell_partial_t1" | "sell_partial_t2" | "sell_trail" | "flatten" | "collapse";

export interface Signal {
  type: SignalType;
  sizeRatio?: number;
  reason?: string;
}
