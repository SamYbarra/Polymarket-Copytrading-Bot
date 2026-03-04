# Trade Bot v3

**Simple 0.35 limit buy strategy with fixed profit targets.**

## Overview

Trade Bot v3 implements a straightforward trading strategy: place Good-Till-Date (GTD) limit buy orders at 0.35, then take profits at fixed price levels (0.4 and 0.5). This bot is designed for simplicity, reliability, and minimal maintenance.

## Strategy Philosophy

- **Simplicity**: Minimal logic, easy to understand and maintain
- **Set-and-Forget**: Places orders and waits for fills
- **Fixed Targets**: Predictable entry and exit points
- **Low Maintenance**: Runs independently with minimal intervention

## Strategy Details

### Buy Strategy

#### Entry Method: GTD Limit Orders

The bot places **Good-Till-Date (GTD)** limit buy orders at a fixed price:

- **Target Price**: `BUY_TARGET_PRICE` (default: 0.35)
- **Order Type**: Limit buy (not market order)
- **Expiration**: Order expires after `GTD_LIFETIME_SEC` (default: 150s = 2.5 minutes)
- **Buffer**: Adds `GTD_BUFFER_SEC` (default: 60s) to expiration for Polymarket requirements

#### Target Side Selection

The bot can target a specific side or auto-select:

- **Fixed Side**: Set `TARGET_OUTCOME=up` or `TARGET_OUTCOME=down` to always buy that side
- **Auto Mode** (default): `TARGET_OUTCOME=auto` selects the side with lower ask price
  - If Up ask ≤ Down ask → buys Up
  - If Down ask < Up ask → buys Down

#### Order Management

- **Placement**: Places new GTD order when:
  - No position exists
  - No pending order exists
  - Previous order expired or was cancelled

- **Monitoring**: Checks order status every loop iteration:
  - If order filled → creates position
  - If order expired/cancelled → places new order

- **Market Switch**: Cancels pending orders when market switches

### Sell Strategy

#### Two-Stage Profit Taking

The bot uses a simple two-stage profit-taking approach:

**Stage 1: First Profit Target (T1)**
- **Trigger Price**: `SELL_T1_PRICE` (default: 0.4)
- **Sell Ratio**: `SELL_T1_RATIO` (default: 0.5 = 50%)
- **Action**: Sells 50% of position when mid price reaches 0.4
- **Example**: Entry at 0.35, 10 shares → sells 5 shares at 0.4

**Stage 2: Second Profit Target (T2)**
- **Trigger Price**: `SELL_T2_PRICE` (default: 0.5)
- **Sell Ratio**: `SELL_T2_RATIO` (default: 0.5 = 50% of remaining)
- **Action**: Sells remaining 50% when mid price reaches 0.5
- **Example**: After T1, 5 shares remaining → sells all 5 at 0.5

#### Exit Conditions

The bot exits positions in these scenarios:

1. **Normal Profit Taking**: T1 then T2 as described above
2. **Market End**: Flattens position when market end time is reached
3. **Market Switch**: Sells stale positions from previous market

### Strategy Logic Flow

```
1. Bot starts → discovers current market
2. Subscribe to price stream for Up/Down tokens
3. Main loop (every LOOP_MS):
   
   If position exists:
     - Check if T1 hit → sell 50%
     - Check if T2 hit → sell remaining 50%
     - If market ended → flatten
   
   Else if pending GTD order exists:
     - Check order status
     - If filled → create position
     - If expired → clear order (will place new next loop)
   
   Else (no position, no pending order):
     - Determine target side (Up/Down/auto)
     - Place GTD limit buy at 0.35
     - Track order ID
```

## Technical Architecture

### Components

```
trade-bot-v3/
├── src/
│   ├── run.ts                 # Main entry point and loop
│   ├── config.ts              # Configuration from env
│   ├── types.ts               # Type definitions
│   ├── price/
│   │   └── market-price-stream.ts  # WebSocket price streaming
│   ├── executor/
│   │   └── market-executor.ts # Order execution (limit buy, market sell)
│   ├── data/
│   │   └── market-data.ts     # Market discovery (Gamma API)
│   └── security/
│       ├── allowance.ts       # Token approval
│       └── createCredential.ts # CLOB credential creation
```

### Key Differences from v2

- **No ML/Ensemble**: Does not use predictions or Redis features
- **Limit Orders**: Uses GTD limit orders instead of market orders
- **Fixed Targets**: Simple price-based triggers, no complex profit-lock engine
- **No Velocity Risk**: Does not monitor BTC/ETH velocity
- **Simpler Loop**: 500ms loop (vs 100ms in v2) - less aggressive

## Configuration

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_TARGET_PRICE` | 0.35 | Limit buy price |
| `GTD_LIFETIME_SEC` | 150 | Order expiration (2.5 min) |
| `GTD_BUFFER_SEC` | 60 | Buffer added to expiration |
| `TARGET_OUTCOME` | auto | Side to buy: "up", "down", or "auto" |
| `BUY_AMOUNT_USD` | 5 | Position size in USD |
| `SELL_T1_PRICE` | 0.4 | First profit target |
| `SELL_T1_RATIO` | 0.5 | Fraction to sell at T1 (50%) |
| `SELL_T2_PRICE` | 0.5 | Second profit target |
| `SELL_T2_RATIO` | 0.5 | Fraction to sell at T2 (50% of remaining) |
| `BOT_LOOP_MS` | 500 | Main loop interval (ms) |
| `ENABLE_TRADING` | true | Enable live trading |
| `MARKET_SLUG_PREFIX` | btc-updown-5m- | Market slug pattern |
| `MARKET_WINDOW_MINUTES` | 5 | Market window duration |

### Example Configuration

```env
# Entry
BUY_TARGET_PRICE=0.35
TARGET_OUTCOME=auto
BUY_AMOUNT_USD=10

# Exits
SELL_T1_PRICE=0.4
SELL_T1_RATIO=0.5
SELL_T2_PRICE=0.5
SELL_T2_RATIO=0.5

# Timing
GTD_LIFETIME_SEC=150
BOT_LOOP_MS=500
```

## Running the Bot

### Prerequisites

- Node.js 18+
- CLOB credentials (`src/data/credential.json` or `CREDENTIAL_PATH`)
- Private key and proxy wallet (if using proxy)

### Setup

```bash
cd trade-bot-v3
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

## Strategy Analysis

### Advantages

- **Simplicity**: Easy to understand and modify
- **Predictable**: Fixed entry/exit points, no complex logic
- **Low Latency Requirements**: 500ms loop is sufficient
- **No External Dependencies**: Doesn't need Redis or ML service
- **Cost Effective**: Limit orders may get better fills than market orders

### Limitations

- **Fixed Entry**: Always buys at 0.35, may miss better opportunities
- **No Risk Management**: No velocity checks or dynamic adjustments
- **Order Expiration**: Orders expire after 2.5 min, may miss late fills
- **Simple Exits**: Fixed targets may not optimize for all market conditions
- **No Prediction**: Doesn't use ML or market analysis

### When to Use

**Best For:**
- Beginners learning trading bot concepts
- Set-and-forget strategies
- Markets where 0.35 is a common support level
- When you want predictable, simple behavior

**Not Ideal For:**
- Volatile markets requiring dynamic entry
- When you need sophisticated risk management
- Markets where 0.35 rarely gets hit
- When you want ML-powered predictions

## Strategy Variations

### Conservative (Lower Risk)

```env
BUY_TARGET_PRICE=0.30      # Lower entry, more margin
SELL_T1_PRICE=0.45         # Higher first target
SELL_T2_PRICE=0.60         # Higher second target
```

### Aggressive (Higher Risk/Reward)

```env
BUY_TARGET_PRICE=0.40      # Higher entry, less margin
SELL_T1_PRICE=0.50         # Higher first target
SELL_T2_PRICE=0.70         # Much higher second target
```

### Quick Profit (Scalping)

```env
BUY_TARGET_PRICE=0.35
SELL_T1_PRICE=0.38         # Quick first exit
SELL_T1_RATIO=0.7          # Take more at first target
SELL_T2_PRICE=0.42         # Quick second exit
```

## Monitoring

### Key Metrics to Watch

1. **Fill Rate**: How often GTD orders get filled
2. **Time to Fill**: Average time from order placement to fill
3. **T1 Hit Rate**: Percentage of positions reaching first target
4. **T2 Hit Rate**: Percentage of positions reaching second target
5. **Average Profit**: Profit per completed trade

### Log Messages

The bot logs key events:

```
[GTD] placed limit buy outcome=Up @ 0.35 amountUsd=5 expires in 210s
[BUY] GTD filled outcome=Up shares=14.29 @ 0.35
[SELL] T1 (50% @ 0.4) shares=7.14 price=0.4
[SELL] T2 (50% @ 0.5) shares=7.14 price=0.5
[SWITCH] next market slug=btc-updown-5m-20240101-1200
```

## Troubleshooting

### Orders Not Filling

- **Price Too Low**: 0.35 may be below market price - check current asks
- **Expiration**: Orders expire after 2.5 min - may need longer lifetime
- **Market Conditions**: In trending markets, price may not retrace to 0.35

### T1/T2 Not Triggering

- **Price Never Reaches**: Check if targets are realistic for market conditions
- **Market Ends Early**: Position may be flattened before targets hit
- **Price Check**: Verify mid price calculation is working

### Market Switch Issues

- **Stale Positions**: Bot should sell positions from previous market
- **Order Cancellation**: Pending orders should be cancelled on switch
- **Check Logs**: Review switch detection logic

## Comparison with Other Bots

| Feature | v2 | v3 | v4 |
|---------|----|----|----|
| Entry Method | Market orders | GTD limit @ 0.35 | GTC limit @ 0.45 (both sides) |
| Prediction | ML/Ensemble | None | None |
| Risk Management | Velocity-based | None | Stop-loss only |
| Profit Management | Multi-stage profit lock | Fixed targets (0.4, 0.5) | Stop-loss (0.15) |
| Complexity | High | Low | Medium |
| Maintenance | High | Low | Medium |

## Related Documentation

- Main `README.md` - Overall system architecture
- `trade-bot-v2/README.md` - Advanced ML-powered bot
- `trade-bot-v4/README.md` - Dual-side strategy
