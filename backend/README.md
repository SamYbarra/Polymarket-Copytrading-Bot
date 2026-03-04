# BTC 5m Tracker — Backend (NestJS)

NestJS API that implements the dashboard data layer itself: MongoDB, Redis, Gamma, CLOB, and BTC price. No proxy to btc5-api.

## Setup

```bash
cp .env.example .env
# Edit .env: PORT, MONGODB_URI, MONGODB_DB, REDIS_HOST, REDIS_PORT
npm install
```

The backend loads `backend/.env` from the app directory, so you can start it from the repo root (e.g. `node backend/dist/main.js`) and it will still read `backend/.env` (including PRIVATE_KEY and CLOB credential for wallet balance / my orders). By default it uses the project's `src/data/credential.json` (same as the tracker); set `CREDENTIAL_PATH` only if you use a different file.

Uses the same MongoDB and Redis as the btc5-tracker (same DB name and Redis keys).

## BTC open price

"BTC open" is the price used for the current market window. Logic matches the tracker:

1. **Source**: Read from Redis first (tracker writes it when a market starts).
2. **Fallback** (if Redis is empty): Binance 1m kline **open** for the market's start minute (`getBtcPriceUsdAtTime(startTime)`). If that fails and we're within 60s of market start, use current Binance price.
3. **Start time**: From Gamma API (`eventStartTime` or `startDate` for the current market).

Polymarket's site may show a different "open" if they use another oracle (e.g. Chainlink) or a different timestamp; we use Binance for consistency with the tracker.

## Run

- **Dev:** `npm run start:dev` — watch mode, port 3006
- **Build:** `npm run build`
- **Prod:** `npm run start:prod` or PM2 (see root `ecosystem.config.cjs`)

## Endpoints

- `GET /api/current-market-state`
- `GET /api/current-market`
- `GET /api/status`
- `GET /api/ml/current`
- `GET /api/wallet-stats`
- `GET /api/predictions?includeResolved=true|false`
- `GET /api/prediction-accuracy`
- `GET /api/results?eventSlug=&conditionId=`
- `GET /api/redis-state`
