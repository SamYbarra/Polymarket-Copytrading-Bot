# Trade Bot v2

**Speed-first, ML-powered trading bot with advanced profit management and velocity risk control.**

## Overview

Trade Bot v2 is a sophisticated trading system designed for active trading on Polymarket prediction markets. It combines machine learning predictions with real-time risk management to optimize entry timing and protect profits through a multi-stage profit-lock engine.

## Design Philosophy

- **Speed-first**: Optimized for low-latency execution with 100ms main loop
- **Self-contained**: No dependency on parent `src/` directory
- **Parallel architecture**: Market refresh, price streaming, and trading logic run independently
- **Real-time price layer**: WebSocket-based top-of-book price updates (best bid/ask only)
- **Market orders only**: Fast execution without limit order management complexity

## Strategy Details

### Buy Strategy

#### Entry Conditions

The bot waits for optimal entry conditions before placing a trade:

1. **Prediction Window**: Must wait at least `PREDICTION_MIN_ELAPSED_SEC` (default: 150s = 2.5 min) after market start
2. **Price Band**: Best ask must be in range `(BUY_PRICE_MIN, BUY_PRICE_MAX)` (default: 0.4-0.8)
3. **Confidence Threshold**: Requires confidence ≥ `MIN_CONFIDENCE` (default: 0.65)
4. **Velocity Guard**: Checks BTC/ETH price velocity to avoid adverse conditions

#### Prediction Sources

The bot uses multiple prediction methods in priority order:

1. **ML Service** (if `ML_SERVICE_URL` configured):
   - Sends market features to XGBoost prediction service
   - Returns predicted outcome and confidence score
   - Requires Redis features from the tracker

2. **Embedded Ensemble** (fallback):
   - Weighted combination of:
     - **Hot Wallet Signal** (50% weight): Tracks successful traders' activity
     - **Orderbook Imbalance** (30% weight): Bid/ask depth analysis
     - **Volume Ratio** (20% weight): Up vs Down volume comparison
   - Calculates prediction score and converts to confidence

3. **Price-Only Fallback**:
   - Uses best ask price as confidence proxy
   - Simple heuristic when features unavailable

#### Velocity-Based Enhancements

When BTC/ETH price velocity is strongly favorable (≥ `VELOCITY_FAVORABLE_FOR_WIDER_BAND` $/s):

- **Wider Band**: Allows buying up to `BUY_PRICE_MAX_FAVORABLE` (default: 0.92) instead of normal max
- **Chase Mode**: Can buy even if price is above normal band if velocity suggests continuation
- **Size Adjustment**: Uses `BUY_AMOUNT_FAVORABLE_RATIO` (default: 0.5) of normal size when chasing

#### Velocity Risk Management

The bot monitors underlying asset (BTC/ETH) price velocity to manage risk:

- **Velocity Calculation**: Rolling window of price changes over `VELOCITY_WINDOW_SEC` (default: 30s)
- **Direction Awareness**: 
  - **Adverse**: Velocity against position (e.g., buying Up when BTC is falling)
  - **Favorable**: Velocity supports position (e.g., buying Up when BTC is rising)

**Buy Protection:**
- **Block Buy**: If `velocityAbs ≥ VELOCITY_BLOCK_USD_PER_SEC` (default: 15 $/s) and adverse
- **Reduce Size**: If `velocityAbs ≥ VELOCITY_REDUCE_USD_PER_SEC` (default: 8 $/s) and adverse → uses 50% of normal size
- **Skip on Any Adverse**: If `VELOCITY_SKIP_BUY_ON_ANY_ADVERSE=true`, blocks any buy when velocity is adverse

**Example**: At $100k BTC, 15 $/s velocity ≈ 0.45% move in 30 seconds. This protects against entering during rapid adverse moves.

### Sell Strategy (Profit Lock Engine)

The profit-lock engine uses a sophisticated multi-stage approach to protect and optimize profits:

#### Stage 1: T1 Target (Partial Profit Taking)

- **Trigger**: Price reaches `T1 = entry + ALPHA1 × (1 - entry)`
  - Default: `ALPHA1 = 0.20` → If entry at 0.5, T1 = 0.5 + 0.2 × 0.5 = 0.6
- **Action**: Sells `R1` fraction of original position (default: 30%)
- **Purpose**: Locks in early profits while keeping exposure for further gains

#### Stage 2: T2 Target (Additional Profit Taking)

- **Trigger**: Price reaches `T2 = entry + ALPHA2 × (1 - entry)`
  - Default: `ALPHA2 = 0.50` → If entry at 0.5, T2 = 0.5 + 0.5 × 0.5 = 0.75
- **Boost**: When velocity is favorable, T2 target is increased:
  - Extra alpha = `min(velocity × PL_T2_BOOST_VELOCITY_SCALE, PL_T2_BOOST_MAX_ALPHA)`
  - Example: 10 $/s favorable velocity → +0.1 alpha → T2 = 0.85 instead of 0.75
- **Action**: Sells `R2` fraction of original position (default: 50%)
- **T1-Before-T2 Rule**: If price jumps directly to T2, takes T1 first (never skips T1)

#### Stage 3: Trailing Stop

- **Activation**: After T1 is hit OR after holding for 30 seconds (whichever comes first)
- **Mechanism**: Tracks high water mark (highest price seen)
- **Trigger**: Price drops to `highWaterMark - TRAIL_DISTANCE`
  - `TRAIL_DISTANCE = (TRAIL_MIN + TRAIL_MAX) / 2` (default: 0.0625)
  - Example: High at 0.8, trail at 0.7375
- **Tightening**: When velocity is high, trail distance is multiplied by `TRAIL_TIGHTEN_MULT` (default: 1.5x)

#### Stage 4: Collapse Protection

- **Trigger**: Price drops by `COLLAPSE_THRESHOLD` (default: 0.10) from entry
  - Example: Entry at 0.5, collapse at 0.4
- **Action**: Sells 50% of remaining position
- **Velocity Adjustment**:
  - **Adverse velocity**: Collapse at normal threshold
  - **Favorable velocity**: Collapse threshold increased by 0.06 (more tolerance)
  - **Near resolution** (≤ `RESOLUTION_SOON_SEC`): Always uses normal threshold (stricter)

#### Stage 5: Time-Based Flatten

- **Trigger**: `FLATTEN_BY_MIN` minutes elapsed (default: 4.5 min)
- **Action**: Sells all remaining position
- **Tightening**: When velocity is high, flattens at `FLATTEN_BY_MIN × FLATTEN_TIGHTEN_MULT` (default: 3.15 min)

#### Stage 6: Reversal Detection

Before executing collapse or flatten, the bot checks for potential reversal:

- **Logic**: If `velocity × leftTime > (currentPrice - marketOpenPrice)`, expects reversal
- **Action**: Skips collapse/flatten to avoid selling before recovery
- **Purpose**: Prevents premature exits during temporary adverse moves

#### Emergency Exits

- **Price Cap**: If price exceeds `PROFIT_LOCK_SELL_ALL_ABOVE` (default: 0.97), sells all immediately
- **Market End**: Flattens position when market end time is reached
- **Market Switch**: Sells stale positions from previous market when switching

### Velocity Integration in Profit Lock

The profit-lock engine adapts to velocity conditions:

- **Tighten Profit Lock**: When `velocityAbs ≥ VELOCITY_TIGHTEN_USD_PER_SEC` (default: 5 $/s) and adverse
  - Reduces flatten time
  - Widens trailing stop (locks profits sooner)
  - Uses stricter collapse threshold

- **Insufficient Momentum**: When velocity is favorable but `projectedMove = velocity × leftTime < INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD` (default: 50 $)
  - Tightens profit lock (expects limited further gains)

## Technical Architecture

### Components

```
trade-bot-v2/
├── src/
│   ├── run.ts                 # Main entry point and loop
│   ├── config.ts              # Configuration from env
│   ├── types.ts                # Type definitions
│   ├── price/
│   │   ├── market-price-stream.ts  # WebSocket price streaming
│   │   ├── btc-price.ts       # BTC price fetching (Binance)
│   │   └── eth-price.ts       # ETH price fetching
│   ├── strategy/
│   │   ├── decision.ts        # Buy decision logic
│   │   ├── ml-prediction.ts   # ML/ensemble prediction
│   │   └── profit-lock.ts     # Profit lock engine
│   ├── executor/
│   │   └── market-executor.ts # Order execution (market buy/sell)
│   ├── risk/
│   │   ├── btc-velocity.ts    # Velocity calculation
│   │   └── velocity-guard.ts # Velocity risk guard
│   ├── data/
│   │   ├── market-data.ts      # Market discovery (Gamma API)
│   │   └── redis-features.ts  # Redis feature reading
│   └── security/
│       ├── allowance.ts       # Token approval
│       └── createCredential.ts # CLOB credential creation
```

### Execution Flow

1. **Initialization**:
   - Loads configuration from `.env`
   - Creates CLOB credential
   - Approves token allowances
   - Connects to Redis (if configured)
   - Starts velocity sampler (if enabled)

2. **Market Discovery**:
   - Fetches current market from Gamma API
   - Subscribes to WebSocket price stream for Up/Down tokens
   - Monitors market switches every 5 seconds

3. **Main Loop** (every `LOOP_MS`, default 100ms):
   - **Price Updates**: Reads best bid/ask from WebSocket stream
   - **Position Management**: If position exists, evaluates profit-lock signals
   - **Buy Evaluation**: If no position, checks buy conditions:
     - Reads features from Redis
     - Gets ML/ensemble prediction
     - Evaluates price band and confidence
     - Checks velocity guard
     - Executes market buy if all conditions met
   - **Sell Execution**: Executes profit-lock sell signals

4. **Background Tasks**:
   - **Market Refresh**: Every 10s, checks for new markets
   - **Window Check**: Every 5s, verifies current market slug
   - **Velocity Sampling**: Polls BTC/ETH price at configured interval

## Configuration

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_PRICE_MIN` / `BUY_PRICE_MAX` | 0.4, 0.8 | Price band for entry |
| `BUY_PRICE_MAX_FAVORABLE` | 0.92 | Max price when velocity favorable |
| `MIN_CONFIDENCE` | 0.65 | Minimum confidence to trade |
| `BUY_AMOUNT_USD` | 5 | Position size in USD |
| `PREDICTION_MIN_ELAPSED_SEC` | 150 | Wait time before trading (2.5 min) |
| `BUY_MAX_ELAPSED_SEC` | 270 | Never buy after this time (4.5 min) |
| `BOT_LOOP_MS` | 100 | Main loop interval (ms) |
| `PL_ALPHA1` / `PL_ALPHA2` | 0.2, 0.5 | Profit lock target alphas |
| `PL_R1` / `PL_R2` | 0.3, 0.5 | Profit lock sell ratios |
| `PL_TRAIL_MIN` / `PL_TRAIL_MAX` | 0.025, 0.10 | Trailing stop range |
| `PL_COLLAPSE` | 0.10 | Collapse threshold |
| `FLATTEN_BY_MIN` | 4.5 | Time-based flatten (minutes) |
| `VELOCITY_ENABLED` | true | Enable velocity risk layer |
| `VELOCITY_BLOCK_USD_PER_SEC` | 15 | Block buy threshold |
| `VELOCITY_REDUCE_USD_PER_SEC` | 8 | Reduce size threshold |
| `VELOCITY_TIGHTEN_USD_PER_SEC` | 5 | Tighten profit lock threshold |
| `VELOCITY_FAVORABLE_FOR_WIDER_BAND` | 8 | Velocity for wider band/chase |
| `REDIS_URL` | - | Redis connection (for features) |
| `ML_SERVICE_URL` | - | ML prediction service URL |
| `ENABLE_TRADING` | true | Enable live trading |
| `ENABLE_ML_BUY` | true | Enable buy logic (set false for dry-run) |

### Velocity Configuration

For velocity risk management, configure Chainlink Data Streams:

```env
CHAINLINK_DS_WS_URL=wss://ws.dataengine.chain.link
CHAINLINK_DS_API_URL=https://api.dataengine.chain.link
CHAINLINK_DS_FEED_ID_BTC_USD=<feed-id-hex>
CHAINLINK_DS_API_KEY=<api-key>
CHAINLINK_DS_USER_SECRET=<user-secret>
```

Or use Binance polling (fallback):
```env
BTC_SAMPLE_INTERVAL_MS=10000
VELOCITY_ASSET=btc  # or eth
```

## Running the Bot

### Prerequisites

- Node.js 18+
- Redis (for ML features, optional)
- ML prediction service running (optional, falls back to ensemble)
- CLOB credentials (`src/data/credential.json` or `CREDENTIAL_PATH`)
- Private key and proxy wallet (if using proxy)

### Setup

```bash
cd trade-bot-v2
npm install
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Run from Repo Root

The bot can be run from repo root (credential path works):

```bash
# From repo root
cd trade-bot-v2
npm run dev
```

## Strategy Performance Considerations

### Advantages

- **ML-Powered**: Uses sophisticated predictions from XGBoost or weighted ensemble
- **Risk Management**: Velocity-based protection prevents bad entries
- **Profit Optimization**: Multi-stage profit lock maximizes gains while protecting downside
- **Speed**: 100ms loop enables fast reaction to market changes
- **Adaptive**: Adjusts behavior based on market conditions (velocity, time remaining)

### Limitations

- **Requires Data**: ML predictions need Redis features from tracker
- **Market Orders**: Pays spread on every trade (no limit order optimization)
- **Complexity**: Many parameters to tune for optimal performance
- **Velocity Dependency**: Requires reliable price feed for velocity calculation

### Best Practices

1. **Start Small**: Test with small position sizes first
2. **Monitor Velocity**: Ensure velocity feed is reliable
3. **Tune Parameters**: Adjust profit-lock targets based on market conditions
4. **Watch Logs**: Monitor buy/sell decisions and velocity guard actions
5. **Dry Run First**: Set `ENABLE_ML_BUY=false` to test logic without trading

## Troubleshooting

### No Buys Executing

- Check `PREDICTION_MIN_ELAPSED_SEC` - may be waiting for prediction window
- Verify confidence threshold (`MIN_CONFIDENCE`)
- Check price band (`BUY_PRICE_MIN`/`BUY_PRICE_MAX`)
- Review velocity guard logs - may be blocking due to adverse velocity
- Ensure Redis features are available (if using ML)

### Velocity Not Working

- Verify `VELOCITY_ENABLED=true`
- Check Chainlink Data Streams credentials
- Ensure `VELOCITY_ASSET` matches market (btc/eth)
- Review velocity sampler logs

### Profit Lock Not Triggering

- Check profit-lock thresholds (`PL_ALPHA1`, `PL_ALPHA2`)
- Verify position is being tracked correctly
- Review profit-lock evaluation logs
- Check if velocity is tightening thresholds

## Related Documentation

- `docs/PROFIT_LOCK_ENGINE.md` - Detailed profit lock specification
- `docs/PROFIT_LOCK_LOGIC.md` - Profit lock logic details
- Main `README.md` - Overall system architecture
