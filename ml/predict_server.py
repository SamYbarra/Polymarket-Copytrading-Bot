#!/usr/bin/env python3
"""
Real-time prediction service: loads trained XGBoost model and exposes POST /predict.
Expects JSON body with the same feature keys as MarketFeatures (or feature_columns).
"""

import os
import json
import argparse
from pathlib import Path

import numpy as np
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

try:
    # Works when run as module: python -m uvicorn ml.predict_server:app
    from ml.feature_columns import FEATURE_COLUMNS, LABEL_UP, LABEL_DOWN
except ImportError:
    # Works when run as script: python ml/predict_server.py
    from feature_columns import FEATURE_COLUMNS, LABEL_UP, LABEL_DOWN

load_dotenv()

DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "artifacts"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = int(os.getenv("ML_PORT", "8005"))

app = FastAPI(title="BTC 5m Prediction API")
model = None
feature_names = None


def load_model(model_dir: Path):
    global model, feature_names
    model_path = model_dir / "model.json"
    names_path = model_dir / "feature_names.json"
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}. Run train.py first.")
    model = xgb.XGBClassifier()
    model.load_model(str(model_path))
    if names_path.exists():
        with open(names_path) as f:
            feature_names = json.load(f)
    else:
        feature_names = FEATURE_COLUMNS


class PredictRequest(BaseModel):
    """Request body: features object (keys match MarketFeatures). Extra keys ignored."""
    model_config = {"extra": "ignore"}
    conditionId: str | None = None
    eventSlug: str | None = None
    timestamp: int | None = None
    minutesElapsed: float = 0
    btcDeltaPctAtPrediction: float = 0
    hotWalletUpVolume: float = 0
    hotWalletDownVolume: float = 0
    hotWalletImbalance: float = 0
    hotWalletCountUp: float = 0
    hotWalletCountDown: float = 0
    hotWalletAvgWinRateUp: float = 0
    hotWalletAvgWinRateDown: float = 0
    hotWalletTotalVolume: float = 0
    orderbookImbalance: float = 0
    spreadRatio: float = 0
    liquidityRatio: float = 0
    totalVolumeUp: float = 0
    totalVolumeDown: float = 0
    volumeRatio: float = 0
    tradeCountUp: float = 0
    tradeCountDown: float = 0
    largeTradeCountUp: float = 0
    largeTradeCountDown: float = 0


@app.on_event("startup")
def startup():
    model_dir = Path(os.getenv("ML_MODEL_DIR", str(DEFAULT_MODEL_DIR)))
    try:
        load_model(model_dir)
    except FileNotFoundError as err:
        # Allow service startup without a model so health checks and management APIs still work.
        print(f"[predict_server] {err}")


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/predict")
def predict(req: PredictRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    # Build feature vector in same order as training
    row = [getattr(req, c) for c in feature_names]
    X = np.array([row], dtype=np.float64)
    proba = model.predict_proba(X)[0]
    # class 0 = Down, class 1 = Up
    prob_up = float(proba[1])
    predicted_outcome = "Up" if prob_up >= 0.5 else "Down"
    confidence = max(prob_up, 1 - prob_up)
    return {
        "predictedOutcome": predicted_outcome,
        "confidence": round(confidence, 4),
        "probUp": round(prob_up, 4),
        "probDown": round(1 - prob_up, 4),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    args = parser.parse_args()
    os.environ["ML_MODEL_DIR"] = str(args.model_dir)
    load_model(args.model_dir)
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
