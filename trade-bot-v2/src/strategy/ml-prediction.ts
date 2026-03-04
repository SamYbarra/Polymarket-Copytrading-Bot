/**
 * ML prediction from features (copied from main PredictionService).
 * When ML_SERVICE_URL is set: POST features to /predict.
 * Otherwise: use embedded ensemble (hot wallet + orderbook + volume).
 */

import { config } from "../config";

/** Features shape must match what the realtime collector writes (MarketFeatures). */
export interface MarketFeatures {
  conditionId: string;
  eventSlug: string;
  timestamp: number;
  minutesElapsed: number;
  btcDeltaPctAtPrediction: number;
  hotWalletUpVolume: number;
  hotWalletDownVolume: number;
  hotWalletImbalance: number;
  hotWalletCountUp: number;
  hotWalletCountDown: number;
  hotWalletAvgWinRateUp: number;
  hotWalletAvgWinRateDown: number;
  hotWalletTotalVolume: number;
  orderbookImbalance: number;
  spreadRatio: number;
  liquidityRatio: number;
  totalVolumeUp: number;
  totalVolumeDown: number;
  volumeRatio: number;
  tradeCountUp: number;
  tradeCountDown: number;
  largeTradeCountUp: number;
  largeTradeCountDown: number;
}

export interface PredictionResult {
  predictedOutcome: "Up" | "Down";
  confidence: number;
  fromEnsemble: boolean;
}

async function predictWithMLService(features: MarketFeatures): Promise<{ predictedOutcome: "Up" | "Down"; confidence: number } | null> {
  const base = config.ML_SERVICE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(features),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { predictedOutcome: "Up" | "Down"; confidence: number };
    return { predictedOutcome: data.predictedOutcome, confidence: Number(data.confidence) };
  } catch {
    return null;
  }
}

function predictWithEnsemble(features: MarketFeatures): { predictedOutcome: "Up" | "Down"; confidence: number } {
  const HOT_WALLET_WEIGHT = 0.5;
  const ORDERBOOK_WEIGHT = 0.3;
  const VOLUME_WEIGHT = 0.2;

  let hotWalletSignal = 0;
  if (features.hotWalletTotalVolume > 0) {
    const upWeight = features.hotWalletCountUp > 0 ? features.hotWalletAvgWinRateUp / 100 : 0.5;
    const downWeight = features.hotWalletCountDown > 0 ? features.hotWalletAvgWinRateDown / 100 : 0.5;
    const weightedUp = features.hotWalletUpVolume * upWeight;
    const weightedDown = features.hotWalletDownVolume * downWeight;
    const totalWeighted = weightedUp + weightedDown;
    if (totalWeighted > 0) {
      hotWalletSignal = (weightedUp - weightedDown) / totalWeighted;
    } else {
      hotWalletSignal = features.hotWalletImbalance;
    }
  }

  const orderbookSignal = features.orderbookImbalance;
  const volumeSignal = features.volumeRatio - 0.5;
  const predictionScore =
    hotWalletSignal * HOT_WALLET_WEIGHT +
    orderbookSignal * ORDERBOOK_WEIGHT +
    volumeSignal * VOLUME_WEIGHT;

  const predictedOutcome: "Up" | "Down" = predictionScore > 0 ? "Up" : "Down";
  const confidence = Math.min(Math.abs(predictionScore) * 2, 1);
  return { predictedOutcome, confidence };
}

/** Predict outcome and confidence from features. Uses ML service if configured, else ensemble. */
export async function predictFromFeatures(features: MarketFeatures): Promise<PredictionResult> {
  const mlResult = await predictWithMLService(features);
  const fromEnsemble = mlResult == null;
  const { predictedOutcome, confidence } = mlResult ?? predictWithEnsemble(features);
  return { predictedOutcome, confidence, fromEnsemble };
}
