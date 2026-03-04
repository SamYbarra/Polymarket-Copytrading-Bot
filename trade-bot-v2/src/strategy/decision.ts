/**
 * Buy decision: price in band + confidence. No parent src.
 */

import { config } from "../config";
import type { Signal } from "../types";

/**
 * Should we buy? Uses bestAsk from market price stream.
 * Buy only when: bestAsk in (BUY_PRICE_MIN, BUY_PRICE_MAX) and confidence >= MIN_CONFIDENCE.
 * Confidence: use bestAsk as proxy (market-implied probability) so we require bestAsk >= 0.65 and in band.
 */
export function shouldBuy(
  bestAsk: number,
  _outcome: "Up" | "Down"
): { buy: boolean; confidence: number } {
  const inBand = bestAsk > config.BUY_PRICE_MIN && bestAsk < config.BUY_PRICE_MAX;
  const confidence = bestAsk;
  const aboveMinConf = confidence >= config.MIN_CONFIDENCE;
  return { buy: inBand && aboveMinConf, confidence };
}
