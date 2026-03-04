# ML prediction in trade-bot-v2

## Default (no ML)

When **REDIS_URL** is not set, the bot uses **price-only** buy logic:

- Outcome and “confidence” come from the order book: it buys the side (Up or Down) whose best ask is in `(BUY_PRICE_MIN, BUY_PRICE_MAX)` and ≥ `MIN_CONFIDENCE` (e.g. 0.65), preferring the higher ask if both are in band.

## Using the ML service

To use **ML (or ensemble) predictions** for the buy decision:

1. **Run the realtime feature collector** so features are written to Redis:
   - From repo root: `npm run realtime:collect` (or run `trade-bot-realtime` feature collector).
   - It writes `realtime:features:{conditionId}` every 2s with market features.

2. **Run Redis** and set **REDIS_URL** in `trade-bot-v2/.env`:
   ```bash
   REDIS_URL=redis://localhost:6379
   ```

3. **Optional: ML service**
   - If you run an ML service that exposes `POST /predict` (JSON body = features, response = `{ predictedOutcome, confidence }`), set:
     ```bash
     ML_SERVICE_URL=http://localhost:8000
     ```
   - If **ML_SERVICE_URL** is not set, the bot uses the **embedded ensemble** (hot wallet + orderbook + volume weights), same as the main repo’s fallback.

4. Start the v2 bot (same as usual). If Redis is connected, it will:
   - Read `realtime:features:{conditionId}` for the current market.
   - Call the ML service (or ensemble) to get `predictedOutcome` and `confidence`.
   - Only consider a buy when the **predicted** outcome’s best ask is in band and `confidence >= MIN_CONFIDENCE`.

## Env summary

| Env var        | Purpose |
|----------------|--------|
| `REDIS_URL`    | Connect to Redis to read features from the collector. If unset, bot uses price-only logic. |
| `ML_SERVICE_URL` | Optional. Base URL of ML service with `POST /predict`. If unset, uses embedded ensemble. |

## Flow

1. **Realtime collector** (separate process): fetches market + wallets, extracts features, writes `realtime:features:{conditionId}` to Redis.
2. **trade-bot-v2**: each loop, if Redis is configured, gets features for current `conditionId`; if present, runs prediction (ML or ensemble) and uses that outcome + confidence for the buy decision, subject to price-in-band and velocity checks.
