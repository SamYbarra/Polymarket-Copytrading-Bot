# XGBoost Training & Real-Time Prediction

## Setup

From the `polymarket-btc5-tracker` directory (or repo root with correct `MONGODB_*`):

```bash
cd polymarket-btc5-tracker
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r ml/requirements.txt
```

Copy `.env` from the tracker root so `MONGODB_URI` and `MONGODB_DB` are set (or set them when running scripts).

## Training

1. **From MongoDB** (recommended): Resolved predictions with `actualOutcome` and `features` are used.
   ```bash
   python ml/train.py
   ```
   Requires at least **50** resolved predictions by default (`--min-samples 50`; use a lower value only if you have very little data). Model and feature list are written to `ml/artifacts/`.

2. **From CSV**: Export first, then train.
   ```bash
   python ml/export_training_data.py -o training_data.csv
   python ml/train.py --data csv --csv training_data.csv
   ```

Options: `--model-dir`, `--test-size`, `--seed`, `--mongodb-uri`, `--mongodb-db`, `--min-samples` (default 50), `--no-time-split`, `--traded-only`. By default a **time-based split** is used (train on oldest, test on newest) to avoid look-ahead. Use `--traded-only` to train only on predictions we actually traded (requires ≥ `--min-samples` rows in `ml_buys`).

## Real-Time Prediction Service

Start the server (loads model from `ml/artifacts/` by default):

```bash
python ml/predict_server.py --port 8005
# or: uvicorn ml.predict_server:app --host 0.0.0.0 --port 8005
```

- `GET /health` — check if model is loaded.
- `POST /predict` — body: JSON object with keys matching `MarketFeatures` (e.g. `hotWalletUpVolume`, `orderbookImbalance`, …). Returns `{ "predictedOutcome": "Up"|"Down", "confidence": number, "probUp", "probDown" }`.

In the tracker `.env`, set:

```env
ML_SERVICE_URL=http://localhost:8005
```

The tracker will call this service at the prediction window (e.g. 2–4 min for 5m markets) and use the returned prediction; if the service is down or unset, it falls back to the built-in weighted ensemble.

## Troubleshooting (PM2)

- **"Model not found ... Run train.py first"**  
  Create the model once (needs at least 50 resolved predictions in MongoDB):  
  `python ml/train.py`  
  Then restart the service: `pm2 restart btc5-ml-service`.

- **"Address already in use" on port 8005**  
  Another process is using 8005. Either:
  1. Stop the ML app and free the port: `pm2 stop btc5-ml-service`, then `pm2 start btc5-ml-service`, or  
  2. Use another port: set `ML_PORT=8006` (or similar) in your env and `ML_SERVICE_URL=http://localhost:8006` in the tracker `.env`, then `pm2 restart btc5-ml-service`.

## Auto-training after resolution

When the **resolver** process resolves a market, it automatically runs `python ml/train.py` in the background (so the model is retrained on the latest resolved predictions). This is enabled by default; set `ENABLE_ML_AUTO_TRAIN=false` in the tracker `.env` to disable. Only one training run runs at a time.

## Recency / rolling-window retrain (discussion)

Right now every auto-train uses **all** resolved predictions in MongoDB. That can dilute recent behaviour: old regimes (different volatility, liquidity, or participant mix) get the same weight as the last few days.

**Options if you want to favour recent data:**

1. **Train only on last N days**  
   In `train.py`, filter the MongoDB cursor with `predictedAt >= (now - N * 86400)` (or use `endTime` on the market). You need enough samples (e.g. ≥ `--min-samples`); for 5m markets that may mean N ≥ 2–4 weeks.

2. **Sample weighting**  
   When building `X, y`, assign higher weight to rows with larger `predictedAt` (e.g. linear or exponential in time). XGBoost supports `sample_weight` in `fit()`. So you’d load `(X, y, predictedAt)`, compute weights, and call `model.fit(X_train, y_train, sample_weight=w_train)`.

3. **Rolling window**  
   Keep only the last M predictions in the training set (e.g. 500). That’s a hard cut: anything older is ignored. Simpler than weighting; you lose long-term stability.

4. **Two-stage or ensemble**  
   Train one model on “all history” and one on “last N days”; at inference use the recent model only when confidence is high, otherwise blend or use the full-history model. More moving parts; only worth it if you see clear regime shifts.

**Recommendation:** Start with (1) once you have enough data (e.g. 100+ predictions). Add (2) if performance still lags in recent periods. Keep `--min-samples` at 50+ so the model doesn’t overfit the recent window.
