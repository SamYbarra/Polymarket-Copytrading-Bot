# How the Tracker + Profit Lock Works

## 1. High-level flow (one process)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  npm run start (index.ts)                                                   │
│  • Connect Redis, MongoDB                                                   │
│  • Trading init (approve, balance) if ENABLE_ML_BUY                         │
│  • Create MarketMonitor(polymarket, redis, mongodb, realtimePriceService)   │
│  • processCycle() once, then every POLL_INTERVAL_SECONDS (e.g. 30s)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  processCycle()                                                              │
│  1. Get current 5m window → fetch market (Gamma) → marketInfo + event        │
│  2. If new market: add to trackedMarkets, set btcOpen, subscribe prices,     │
│     sync positions from Data API                                             │
│  3. If same market: maybe sync positions again (every POSITIONS_SYNC_* s)    │
│  4. For this market:                                                         │
│     • If window ended → queue for finalize                                   │
│     • Else:                                                                 │
│       – If in prediction window & not yet predicted → makePrediction()       │
│       – If predicted but no buy & retry interval passed → makePrediction()   │
│       – If ENABLE_PROFIT_LOCK and we have an open position → runProfitLock() │
│  5. For each market queued for finalize: finalizeMarket(), cleanup,         │
│     unsubscribe prices, delete profitLockPositions                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Prediction → Buy flow

```
┌──────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ makePrediction() │     │ FeatureExtractor     │     │ PredictionService   │
│                  │────▶│ extractFeatures()    │────▶│ predictOnly()       │
│ (conditionId,    │     │ (wallets, orderbook, │     │ ML service or       │
│  marketInfo,     │     │  hot wallets, volume)│     │ ensemble            │
│  minutesElapsed) │     └─────────────────────┘     └──────────┬──────────┘
└──────────────────┘                                              │
       │                                                           ▼
       │                                            ┌─────────────────────────┐
       │                                            │ prediction: outcome,    │
       │                                            │ confidence, fromEnsemble│
       │                                            └──────────┬──────────────┘
       │                                                       │
       │  Checks: confidence ≥ min, delta > SAFE_DELTA,        │
       │          execution price in [BUY_PRICE_MIN, MAX],      │
       │          ENSEMBLE allowed if fromEnsemble             │
       │                                                       ▼
       │                                            ┌─────────────────────────┐
       │                                            │ buyWinToken()           │
       │                                            │ CLOB market BUY,        │
       │                                            │ addHoldings(), saveMlBuy│
       │                                            └──────────┬──────────────┘
       │                                                       │
       │                                            if bought & ENABLE_PROFIT_LOCK
       │                                                       ▼
       │                                            ┌─────────────────────────┐
       │                                            │ Create ProfitLockPosition│
       │                                            │ State, store in         │
       │                                            │ profitLockPositions(cid)│
       │                                            └─────────────────────────┘
       ▼
  Save prediction (wouldBuy, traded), update predictedMarkets / tradedMarkets
```

---

## 3. Profit Lock flow (each cycle, when we have an open position)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  runProfitLock(conditionId, marketInfo, nowSec)                               │
│  • position = profitLockPositions.get(conditionId)                           │
│  • Get tokenId (Up or Down) for our outcome                                   │
│  • Get order book → bestBid, bestAsk, mid, spread, depthOurSide              │
│  • updateHighWaterMark(position, mid)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  evaluateProfitLock(input, params)  ← docs/PROFIT_LOCK_ENGINE.md             │
│  Priority order (first that fires wins):                                     │
│  1. Collapse    : adverse move (entryPrice − mid) ≥ threshold → exit 50%     │
│  2. T1          : mid ≥ P_t1, !t1Hit → sell_partial_t1 (r1 of original)     │
│  3. T2          : mid ≥ P_t2, !t2Hit → sell_partial_t2 (r2 of original)     │
│  4. T3          : low vol only, mid ≥ P_t3 → sell remainder                   │
│  5. Trail       : (t1Hit or 30s in profit), mid ≤ highWaterMark − D → sell   │
│  6. Time decay  : minutesElapsed ≥ flattenByMin (e.g. 4.5) → flatten rest    │
│  7. Hold        : none of the above                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                        action.type !== "hold"
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Compute sell size:                                                          │
│  • T1 / T2: originalShares * sizeRatio                                       │
│  • T3 / flatten / trail / collapse: remainingShares (or * ratio for collapse)│
│  • toSell = min(sellSize, remainingShares, getHoldings(conditionId, tokenId))│
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  sellWinToken(tokenId, toSell, conditionId, realtimePriceService)            │
│  • CLOB createAndPostMarketOrder SELL, amount = toSell                       │
│  • On fill: reduceHoldings(conditionId, tokenId, soldAmount)                 │
│  • position.remainingShares -= toSell                                        │
│  • If T1/T2: set position.t1Hit / t2Hit                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. End of window (finalize)

```
  now >= marketInfo.endTime
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  finalizeMarket(conditionId, marketInfo)                                     │
│  • Get wallets from Redis (totalBuyUsd ≥ MIN_BUY_USD)                        │
│  • Save market_results (resolvedOutcome = null; resolver fills later)         │
│  • redis.deleteMarket(conditionId)                                           │
│  • realtimePriceService.unsubscribe(conditionId)                             │
│  • profitLockPositions.delete(conditionId)                                   │
│  • trackedMarkets / predictedMarkets / tradedMarkets cleanup                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Data flow summary

```
  Gamma API (event/market)     Redis (wallets, btcOpen)     MongoDB (predictions, ml_buys, market_results)
           │                              │                                    │
           ▼                              ▼                                    ▼
  ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
  │ MarketMonitor   │◀────────▶│ Positions sync  │          │ savePrediction   │
  │ processCycle    │          │ Wallet data     │          │ saveMlBuy        │
  │                 │          │                 │          │ saveMarketResult │
  └────────┬────────┘          └─────────────────┘          └─────────────────┘
           │
           ├── RealtimePriceService (WebSocket + HTTP fallback) → order book, mid
           ├── buyWinToken → CLOB BUY, addHoldings (file: token-holding.json)
           └── sellWinToken → CLOB SELL, reduceHoldings
```

---

## 6. Env flags that affect behavior

| Variable | Effect |
|----------|--------|
| `ENABLE_ML_BUY` | If false: no buy, no sell (trading off). |
| `ENABLE_PROFIT_LOCK` | If false: buy only, hold to resolution; no partial/trail exits. |
| `POLL_INTERVAL_SECONDS` | How often `processCycle()` runs (e.g. 30). |
| `PREDICTION_MIN_ELAPSED_SECONDS` | No predict/buy before this many seconds after market start (e.g. 150). |
| `PREDICTION_TIME_MIN` / `PREDICTION_TIME_MAX` | Prediction window in minutes (e.g. 2–4). |

---

## 7. Quick reference: where things live

| What | Where |
|------|--------|
| Main loop | `src/index.ts` → `MarketMonitor.processCycle()` |
| Predict + buy | `src/services/market-monitor.ts` → `makePrediction()` → `trading-service.buyWinToken()` |
| Profit lock eval | `src/services/profit-lock/evaluator.ts` → `evaluateProfitLock()` |
| Sell execution | `src/services/sell-service.ts` → `sellWinToken()` |
| Position state | `market-monitor.ts` → `profitLockPositions` Map |
| Holdings (buy/sell) | `src/utils/holdings.ts` (file: `src/data/token-holding.json`) |
| Design spec | `docs/PROFIT_LOCK_ENGINE.md` |
