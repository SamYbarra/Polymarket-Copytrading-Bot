# Polymarket AI Trading Bot

A comprehensive trading system for Polymarket prediction markets, featuring multiple trading strategies, ML-powered predictions, real-time market monitoring, and a full-stack dashboard for bot status tracking.

## 🏗️ Architecture Overview

This project consists of several independent modules working together:

- **`src/`** - Core market monitoring and data collection system (BTC 5m Tracker)
- **`trade-bot-v2/`** - Advanced ML-based trading bot with profit-lock engine
- **`trade-bot-v3/`** - Simple 0.35 limit buy strategy with fixed sell targets
- **`trade-bot-v4/`** - Dual-side limit buy strategy with stop-loss protection
- **`backend/`** - NestJS API server for dashboard data
- **`frontend/`** - React dashboard for monitoring bot status and performance
- **`ml/`** - XGBoost model training and prediction service
- **`regime-monitor/`** - Market regime detection and monitoring

## 📦 Module Descriptions

### Core System (`src/`)

The **BTC 5m Tracker** is the foundation of the system. It:

- Monitors 5-minute BTC up/down prediction markets on Polymarket
- Tracks wallet activity and identifies "hot wallets" (successful traders)
- Collects real-time market features (orderbook, volume, wallet flows)
- Stores predictions and outcomes in MongoDB
- Writes real-time features to Redis for trading bots
- Can optionally execute trades (legacy trading logic)

**Key Components:**
- `MarketMonitor` - Main market cycle processor
- `RealtimePriceService` - WebSocket price streaming
- `MongoDBClient` - Prediction and outcome storage
- `RedisClient` - Real-time feature cache
- `PolymarketClient` - Gamma API and CLOB integration

### Trading Bots

#### Trade Bot v2 (`trade-bot-v2/`)

**Strategy Type:** ML-Powered Active Trading with Advanced Profit Management

**Key Features:**
- **ML/Ensemble Predictions**: Uses XGBoost model or weighted ensemble (hot wallets + orderbook + volume)
- **Velocity Risk Management**: Monitors BTC/ETH price velocity to block/reduce trades during high volatility
- **Advanced Profit Lock Engine**: Multi-stage profit protection with T1/T2 targets, trailing stops, time-based flattening, and collapse protection
- **Market Orders**: Fast execution using market orders only
- **Real-time Price Stream**: WebSocket-based top-of-book price updates

**Buy Logic:**
- Waits for prediction window (default: 2.5-4.5 minutes after market start)
- Requires confidence ≥ 0.65 and price in band (0.4-0.8)
- Can "chase" favorable moves when velocity is strongly favorable
- Velocity guard blocks/reduces size during adverse conditions

**Sell Logic:**
- T1: Sell 20% at target price (entry + 20% of remaining profit potential)
- T2: Sell 30% at higher target (entry + 50% of remaining profit potential, boosted by favorable velocity)
- Trailing stop: Protects profits after T1 or 30s hold
- Collapse: Sells 50% if price drops significantly (threshold varies by velocity)
- Time flatten: Sells all remaining at 4.5 minutes (configurable)
- Reversal detection: Skips collapse/flatten if velocity suggests price recovery

**Best For:** Active trading with sophisticated risk management and profit optimization.

---

#### Trade Bot v3 (`trade-bot-v3/`)

**Strategy Type:** Simple Limit Order Strategy

**Key Features:**
- **GTD Limit Orders**: Good-Till-Date limit buy orders at fixed price (0.35)
- **Fixed Sell Targets**: Simple two-stage profit taking
- **Low Maintenance**: Minimal logic, runs independently

**Buy Logic:**
- Places GTD limit buy order at 0.35 on target side (Up/Down/auto)
- Order expires after 2.5 minutes if not filled
- Automatically places new order if previous expires or fills

**Sell Logic:**
- Sell 50% when mid price reaches 0.4
- Sell remaining 50% when mid price reaches 0.5
- Flattens position if market ends or switches

**Best For:** Simple, set-and-forget trading with minimal complexity.

---

#### Trade Bot v4 (`trade-bot-v4/`)

**Strategy Type:** Dual-Side Limit Buy with Stop-Loss

**Key Features:**
- **Both Sides**: Places limit buy orders on both Up and Down tokens simultaneously
- **Early Entry**: Orders placed within first minute of market open
- **Stop-Loss Protection**: Automatic sell if price drops below 0.15
- **Auto-Redeem**: Automatically redeems winning positions after market resolution

**Buy Logic:**
- Places GTC limit buy orders at 0.45 on both Up and Down tokens
- Orders placed only during first 60 seconds of market
- Each side uses independent position tracking

**Sell Logic:**
- Stop-loss: Sells immediately if mid price < 0.15 (prevents large losses)
- Market end: Flattens all positions before resolution
- Auto-redeem: Redeems winning tokens after condition resolves

**Best For:** Market-neutral strategies or when you want exposure to both outcomes.

---

### Backend (`backend/`)

NestJS REST API that provides:

- Current market state and predictions
- Wallet statistics and balance tracking
- ML prediction accuracy metrics
- Historical predictions and results
- Redis state inspection

**Endpoints:**
- `GET /api/current-market-state` - Live market data
- `GET /api/ml/current` - Current ML prediction
- `GET /api/wallet-stats` - Wallet balance and trading stats
- `GET /api/predictions` - Historical predictions
- `GET /api/prediction-accuracy` - Model performance metrics

**Purpose:** Serves data to the frontend dashboard and can be used for external monitoring.

---

### Frontend (`frontend/`)

React (Vite) dashboard for real-time bot monitoring:

- **Dashboard Page**: Live market prices, current ML prediction, wallet stats
- **Predictions Page**: Historical predictions with accuracy tracking
- **Wallets Page**: Hot wallet tracking and analysis
- **Auto-refresh**: Polls backend every 5 seconds

**Purpose:** Visual monitoring of bot status, predictions, and performance.

---

### ML Module (`ml/`)

XGBoost-based machine learning system:

- **Training**: Trains on historical predictions with actual outcomes
- **Features**: Uses market features (hot wallet activity, orderbook imbalance, volume ratios, etc.)
- **Prediction Service**: HTTP API for real-time predictions
- **Auto-retraining**: Automatically retrains after each market resolution

**Features Used:**
- Hot wallet volume and win rates
- Orderbook imbalance
- Volume ratios
- Trade counts
- BTC price delta at prediction time

**Purpose:** Provides ML predictions to trading bots (especially v2) for better entry decisions.

---

### Regime Monitor (`regime-monitor/`)

Market regime detection system for identifying different market conditions.

**Purpose:** Helps adapt trading strategies based on market volatility and conditions.

---

## 🔄 System Flow

### Data Collection Flow

1. **Tracker (`src/`)** monitors markets every 30 seconds
2. Collects wallet activity, orderbook data, volume metrics
3. Writes real-time features to Redis (`realtime:features:{conditionId}`)
4. Stores predictions and outcomes in MongoDB
5. ML service reads from MongoDB for training

### Trading Flow (Bot v2 Example)

1. **Bot starts** and subscribes to current market WebSocket
2. **Price stream** updates best bid/ask in real-time
3. **Main loop** (every 100ms):
   - Checks if prediction window has passed
   - Reads features from Redis
   - Gets ML prediction (or uses ensemble)
   - Evaluates buy conditions (price band, confidence, velocity)
   - Executes market buy if conditions met
   - Monitors position and evaluates profit-lock signals
   - Executes sells based on profit-lock engine
4. **Market switch** detected every 5 seconds, bot switches to new market

### ML Training Flow

1. Markets resolve and outcomes are recorded
2. Resolver triggers auto-training (if enabled)
3. `ml/train.py` loads resolved predictions from MongoDB
4. Trains XGBoost model on features vs actual outcomes
5. Saves model to `ml/artifacts/`
6. Prediction service loads new model for next predictions

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.9+ (for ML module)
- MongoDB (for predictions storage)
- Redis (for real-time features)
- Polygon RPC access (for on-chain operations)
- Polymarket CLOB credentials

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repo>
   cd Polymarket-AI-Trading-Bot
   npm install
   ```

2. **Configure environment:**
   ```bash
   # Main tracker
   cp .env.example .env
   # Edit .env with MongoDB, Redis, CLOB credentials
   
   # Trading bot v2
   cd trade-bot-v2
   cp .env.example .env
   # Edit .env with trading parameters
   
   # Backend
   cd ../backend
   cp .env.example .env
   
   # Frontend
   cd ../frontend
   cp .env.example .env
   ```

3. **Start services:**
   ```bash
   # Terminal 1: Tracker (data collection)
   npm start
   
   # Terminal 2: ML Prediction Service
   cd ml
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python predict_server.py
   
   # Terminal 3: Trading Bot v2
   cd trade-bot-v2
   npm run dev
   
   # Terminal 4: Backend API
   cd backend
   npm run start:dev
   
   # Terminal 5: Frontend Dashboard
   cd frontend
   npm run dev
   ```

---

## 📊 Important Concepts

### Market Windows

Markets run in 5-minute windows. Each window:
- Starts at a fixed time (e.g., :00, :05, :10, :15, etc.)
- Has a condition ID that resolves to Up or Down
- Uses BTC price at window start vs window end to determine outcome

### Hot Wallets

Wallets that have shown consistent profitability. The system:
- Tracks wallet win rates
- Monitors their trading activity
- Uses their volume and direction as a prediction signal

### Profit Lock Engine (v2)

Sophisticated profit protection system:
- **T1/T2 Targets**: Partial profit taking at calculated price levels
- **Trailing Stop**: Protects profits by following price up
- **Collapse Protection**: Sells partial position if price drops significantly
- **Time Flatten**: Ensures position is closed before market end
- **Velocity Integration**: Adjusts thresholds based on underlying asset volatility

### Velocity Risk Management

Monitors BTC/ETH price velocity ($/second):
- **Blocks buys** if velocity is too high and adverse to position
- **Reduces size** if velocity is moderately high
- **Allows wider bands** if velocity is strongly favorable
- **Tightens profit lock** during high volatility

---

## 🔧 Configuration

### Key Environment Variables

**Tracker (`src/`):**
- `MONGODB_URI` - MongoDB connection string
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `MARKET_SLUG_PREFIX` - Market slug pattern (e.g., `btc-updown-5m-`)
- `ML_SERVICE_URL` - ML prediction service URL

**Trading Bot v2:**
- `BUY_PRICE_MIN`, `BUY_PRICE_MAX` - Price band for entries (default: 0.4, 0.8)
- `MIN_CONFIDENCE` - Minimum confidence to trade (default: 0.65)
- `BUY_AMOUNT_USD` - Position size in USD
- `VELOCITY_ENABLED` - Enable velocity risk management
- `PREDICTION_MIN_ELAPSED_SECONDS` - Wait time before trading (default: 150)

**Trading Bot v3:**
- `BUY_TARGET_PRICE` - Limit buy price (default: 0.35)
- `SELL_T1_PRICE`, `SELL_T2_PRICE` - Sell targets (default: 0.4, 0.5)
- `GTD_LIFETIME_SEC` - Order expiration (default: 150)

**Trading Bot v4:**
- `BUY_LIMIT_PRICE` - Limit buy price for both sides (default: 0.45)
- `SELL_IF_BELOW` - Stop-loss threshold (default: 0.15)
- `BUY_WINDOW_SEC` - Time window to place orders (default: 60)

---

## 📁 Project Structure

```
Polymarket-AI-Trading-Bot/
├── src/                    # Core tracker (market monitoring, data collection)
│   ├── services/          # Market monitor, trading service, etc.
│   ├── clients/           # Polymarket, Redis, MongoDB clients
│   └── scripts/           # Utility scripts
├── trade-bot-v2/          # ML-powered trading bot
│   ├── src/
│   │   ├── strategy/      # Decision logic, profit lock, ML prediction
│   │   ├── executor/      # Order execution
│   │   ├── price/         # Price streaming
│   │   └── risk/          # Velocity risk management
│   └── docs/              # Strategy documentation
├── trade-bot-v3/          # Simple 0.35 limit buy strategy
├── trade-bot-v4/          # Dual-side limit buy strategy
├── backend/               # NestJS API for dashboard
├── frontend/              # React dashboard
├── ml/                    # XGBoost training and prediction
│   ├── train.py           # Model training
│   ├── predict_server.py  # Prediction API
│   └── artifacts/         # Trained models
├── regime-monitor/        # Market regime detection
└── docs/                  # Additional documentation
```

---

## 🎯 Choosing a Trading Bot

- **Use v2** if you want:
  - ML-powered predictions
  - Advanced profit management
  - Active risk management
  - Best for experienced traders

- **Use v3** if you want:
  - Simple, predictable strategy
  - Low maintenance
  - Fixed entry/exit points
  - Best for beginners

- **Use v4** if you want:
  - Market-neutral exposure
  - Early market entry
  - Stop-loss protection
  - Best for risk-averse strategies

---

## 📚 Additional Documentation

- `docs/FLOW.md` - Detailed system flow
- `docs/PROFIT_LOCK_ENGINE.md` - Profit lock engine specification
- `docs/PROFIT_LOCK_LOGIC.md` - Profit lock logic details
- `docs/REDIS_STRUCTURE.md` - Redis key structure
- `trade-bot-v2/docs/` - v2 strategy documentation

---

## ⚠️ Important Notes

1. **Trading Risk**: All trading bots execute real trades. Start with small amounts and test thoroughly.

2. **Credentials**: Store private keys securely. Use proxy wallets when possible.

3. **Market Conditions**: Strategies may perform differently in different market regimes.

4. **ML Model**: Requires sufficient training data (50+ resolved predictions minimum).

5. **Network**: Requires stable connection for WebSocket price streams.

6. **Monitoring**: Always monitor bot activity, especially during high volatility periods.

---
