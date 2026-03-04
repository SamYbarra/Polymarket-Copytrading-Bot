/**
 * Append-only trade logs: sell.json and buy.json (NDJSON, one object per line).
 * Used for debugging and audit: which condition triggered, reason, and detailed values.
 */

import { appendFile } from "fs/promises";
import { resolve } from "path";

const packageDir = resolve(__dirname, "..");

export interface SellLogEntry {
  ts: string;
  condition: string;
  reason: string;
  orderType: "market" | "limit";
  tokenId: string;
  outcome: "Up" | "Down";
  sharesSold: number;
  price: number;
  filledShares?: number;
  position: {
    conditionId: string;
    entryPrice: number;
    entryTimeSec: number;
    sharesBefore: number;
    remainingAfter: number;
    highWaterMark: number;
    t1Hit: boolean;
    t2Hit: boolean;
  };
  market: {
    startTime: number;
    endTime: number;
    leftTimeSec?: number;
  };
  velocity?: {
    asset: string;
    lastPrice: number | null;
    velocityAbs: number | null;
    velocitySigned: number | null;
  };
  signal?: {
    type: string;
    sizeRatio?: number;
  };
}

export interface BuyLogEntry {
  ts: string;
  condition: string;
  outcome: "Up" | "Down";
  tokenId: string;
  shares: number;
  entryPrice: number;
  amountUsd: number;
  confidence: number;
  velocity?: {
    asset: string;
    lastPrice: number | null;
    velocityAbs: number | null;
    velocitySigned: number | null;
    favorable: boolean;
    reduceSize: boolean;
  };
  market: {
    conditionId: string;
    startTime: number;
    endTime: number;
    elapsedSec: number;
  };
  band: {
    useWiderBandOrChase: boolean;
    buyPriceMin: number;
    buyPriceMaxEffective: number;
  };
}

function ndjsonLine(obj: object): string {
  return JSON.stringify(obj) + "\n";
}

export async function logSell(entry: SellLogEntry): Promise<void> {
  try {
    const path = resolve(packageDir, "sell.json");
    await appendFile(path, ndjsonLine(entry), "utf-8");
  } catch (e) {
    console.error("[log-trades] logSell failed", e);
  }
}

export async function logBuy(entry: BuyLogEntry): Promise<void> {
  try {
    const path = resolve(packageDir, "buy.json");
    await appendFile(path, ndjsonLine(entry), "utf-8");
  } catch (e) {
    console.error("[log-trades] logBuy failed", e);
  }
}
