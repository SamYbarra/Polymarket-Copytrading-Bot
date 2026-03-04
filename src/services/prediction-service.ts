/**
 * Prediction Service: ML-based prediction of market outcome using features.
 * Uses trained XGBoost via ML_SERVICE_URL when set; otherwise weighted ensemble.
 */

import { MongoDBClient } from "../clients/mongodb";
const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};
import type { MarketFeatures, MarketPrediction } from "../types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL?.replace(/\/$/, "");

export class PredictionService {
  private mongodb: MongoDBClient;

  constructor(mongodb: MongoDBClient) {
    this.mongodb = mongodb;
  }

  private async predictWithMLService(features: MarketFeatures): Promise<{ predictedOutcome: "Up" | "Down"; confidence: number } | null> {
    if (!ML_SERVICE_URL) return null;
    try {
      const res = await fetch(`${ML_SERVICE_URL}/predict`, {
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

  private predictWithEnsemble(features: MarketFeatures): { predictedOutcome: "Up" | "Down"; confidence: number } {
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

  /** Returns prediction without saving (for retries; save on buy or at finalize). */
  async predictOnly(features: MarketFeatures): Promise<MarketPrediction> {
    const mlResult = await this.predictWithMLService(features);
    const fromEnsemble = mlResult == null;
    const { predictedOutcome, confidence } = mlResult ?? this.predictWithEnsemble(features);

    const prediction: MarketPrediction = {
      conditionId: features.conditionId,
      eventSlug: features.eventSlug,
      predictedOutcome,
      confidence,
      features,
      predictedAt: features.timestamp,
      actualOutcome: null,
      isCorrect: null,
      accuracyUpdatedAt: null,
      fromEnsemble,
    };

    console.log(
      `${ts()} 🤖 ${shortId(features.conditionId)} → ${predictedOutcome} (${(confidence * 100).toFixed(1)}%)${mlResult ? " [ML]" : " [ensemble]"}`
    );

    return prediction;
  }

  async predict(features: MarketFeatures): Promise<MarketPrediction> {
    const prediction = await this.predictOnly(features);
    await this.mongodb.savePrediction(prediction);
    return prediction;
  }

  async updatePredictionAccuracy(conditionId: string, actualOutcome: "Up" | "Down"): Promise<void> {
    await this.mongodb.updatePredictionAccuracy(conditionId, actualOutcome);
  }
}
