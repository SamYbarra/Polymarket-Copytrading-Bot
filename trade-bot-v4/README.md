# Trade Bot v4

**Dual-side limit buy strategy with stop-loss protection and auto-redeem.**

## Overview

Trade Bot v4 implements a market-neutral approach by placing limit buy orders on both Up and Down tokens simultaneously at market open. It includes stop-loss protection and automatically redeems winning positions after market resolution.

## Strategy Philosophy

- **Market Neutral**: Buys both sides to reduce directional risk
- **Early Entry**: Places orders within first minute of market open
- **Risk Protection**: Stop-loss prevents large losses
- **Automation**: Auto-redeems winning positions after resolution

## Strategy Details

### Buy Strategy

#### Dual-Side Limit Orders

The bot places **Good-Till-Canceled (GTC)** limit buy orders on both sides:

- **Target Price**: `BUY_LIMIT_PRICE` (default: 0.45) for both Up and Down
- **Order Type**: GTC limit buy (orders remain active until filled or cancelled)
- **Timing**: Orders placed only during `BUY_WINDOW_SEC` (default: 60s = first minute)
- **Independence**: Each side (Up/Down) is tracked separately

#### Order Placement Logic

```
Market starts → Bot detects new market
Within first 60 seconds:
  - Place GTC limit buy on Up token @ 0.45
  - Place GTC limit buy on Down token @ 0.45
  - Track both order IDs independently
After 60 seconds:
  - No new orders placed (even if previous expired)
```

#### Position Tracking

The bot maintains separate positions for each side:

- **positionUp**: Tracks Up token position (if filled)
- **positionDown**: Tracks Down token position (if filled)
- **Independent Management**: Each position managed separately

### Sell Strategy

#### Stop-Loss Protection

The primary sell mechanism is a stop-loss to prevent large losses:

- **Trigger Price**: `SELL_IF_BELOW` (default: 0.15)
- **Action**: Sells entire position when mid price drops below threshold
- **Pricing**: Sells at `bestBid - SELL_LAG` (default: 0.01) to ensure fill
- **Protection**: Prevents holding losing positions until market end

**Example**: 
- Buy Up at 0.45, price drops to 0.14
- Stop-loss triggers → sells at 0.13 (bid - 0.01 lag)
- Limits loss to ~71% instead of potential 100%

#### Market End Flattening

Before market resolution:

- **Trigger**: When `nowSec >= marketInfo.endTime`
- **Action**: 
  - Cancels any pending limit orders
  - Sells all remaining positions (both Up and Down)
  - Prepares for auto-redeem

#### Auto-Redeem

After market ends and condition resolves:

- **Trigger**: Market end time reached + condition is resolved
- **Action**: Automatically redeems winning tokens
- **Purpose**: Converts winning positions to collateral without manual intervention
- **One-Time**: Only attempts redeem once per condition ID

**Redeem Logic**:
```
Market ends → Wait for resolution
Check condition resolution status
If resolved:
  - Redeem winning tokens (Up if BTC went up, Down if BTC went down)
  - Convert to USDC collateral
```

### Strategy Logic Flow

```
1. Bot starts → discovers current market
2. Subscribe to price stream for Up/Down tokens
3. Main loop (every LOOP_MS):
   
   If market ended:
     - Cancel pending orders
     - Flatten all positions
     - Attempt auto-redeem (if enabled)
   
   Else:
     If positionUp exists:
       - Check stop-loss (mid < 0.15) → sell if triggered
     
     If positionDown exists:
       - Check stop-loss (mid < 0.15) → sell if triggered
     
     If elapsed < BUY_WINDOW_SEC (60s):
       - If Up order not attempted → place GTC limit buy Up @ 0.45
       - If Down order not attempted → place GTC limit buy Down @ 0.45
     
     Check pending orders for fills:
       - If Up order filled → create positionUp
       - If Down order filled → create positionDown
```

## Technical Architecture

### Components

```
trade-bot-v4/
├── src/
│   ├── run.ts                 # Main entry point and loop
│   ├── config.ts              # Configuration from env
│   ├── types.ts               # Type definitions
│   ├── price/
│   │   └── market-price-stream.ts  # WebSocket price streaming
│   ├── executor/
│   │   └── market-executor.ts # Order execution (limit buy, market sell)
│   ├── redeem/
│   │   └── redeem.ts          # Auto-redeem logic
│   ├── data/
│   │   └── market-data.ts     # Market discovery (Gamma API)
│   └── security/
│       ├── allowance.ts       # Token approval
│       └── createCredential.ts # CLOB credential creation
```

### Key Features

- **Dual Position Tracking**: Separate state for Up and Down positions
- **Early Entry Window**: Only places orders in first minute
- **Stop-Loss**: Real-time price monitoring for risk protection
- **Auto-Redeem**: Automatic conversion of winning positions

## Configuration

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_LIMIT_PRICE` | 0.45 | Limit buy price for both sides |
| `BUY_AMOUNT_USD` | 5 | Position size per side (USD) |
| `BUY_WINDOW_SEC` | 60 | Time window to place orders (first minute) |
| `SELL_IF_BELOW` | 0.15 | Stop-loss threshold |
| `SELL_LAG` | 0.01 | Price lag for stop-loss sell (bid - lag) |
| `AUTO_REDEEM` | true | Enable auto-redeem after resolution |
| `BOT_LOOP_MS` | 500 | Main loop interval (ms) |
| `ENABLE_TRADING` | true | Enable live trading |
| `MARKET_SLUG_PREFIX` | btc-updown-5m- | Market slug pattern |
| `MARKET_WINDOW_MINUTES` | 5 | Market window duration |

### Example Configuration

```env
# Entry (both sides)
BUY_LIMIT_PRICE=0.45
BUY_AMOUNT_USD=10
BUY_WINDOW_SEC=60

# Risk Management
SELL_IF_BELOW=0.15
SELL_LAG=0.01

# Automation
AUTO_REDEEM=true

# Timing
BOT_LOOP_MS=500
```

## Running the Bot

### Prerequisites

- Node.js 18+
- CLOB credentials (`src/data/credential.json` or `CREDENTIAL_PATH`)
- Private key and proxy wallet (if using proxy)

### Setup

```bash
cd trade-bot-v4
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

- **Market Neutral**: Reduces directional risk by buying both sides
- **Early Entry**: Gets in at market open when prices are typically closer to 0.5
- **Stop-Loss Protection**: Limits downside risk automatically
- **Automation**: Auto-redeem eliminates manual intervention
- **Simple Logic**: Easy to understand and maintain

### Limitations

- **Capital Requirement**: Needs 2x capital (both sides)
- **No Profit Taking**: Only stop-loss, no profit targets
- **Early Entry Risk**: Prices at open may not be optimal
- **No Prediction**: Doesn't use ML or market analysis
- **Fixed Entry**: Always buys at 0.45, may miss better prices

### When to Use

**Best For:**
- Market-neutral strategies
- When you want exposure to both outcomes
- Risk-averse trading (stop-loss protection)
- Automated systems (auto-redeem)
- Markets where 0.45 is a reasonable entry

**Not Ideal For:**
- Directional trading (better to use v2 or v3)
- When capital is limited (requires 2x position size)
- Markets with high volatility (stop-loss may trigger frequently)
- When you want profit optimization (no profit targets)

## Strategy Variations

### Conservative (Tighter Stop-Loss)

```env
BUY_LIMIT_PRICE=0.40      # Lower entry, more margin
SELL_IF_BELOW=0.20        # Wider stop-loss (less sensitive)
SELL_LAG=0.02             # Larger lag for better fills
```

### Aggressive (Tighter Entry)

```env
BUY_LIMIT_PRICE=0.50      # Higher entry, less margin
SELL_IF_BELOW=0.10        # Tighter stop-loss (more sensitive)
BUY_WINDOW_SEC=30         # Shorter entry window
```

### Scalping (Quick Entry/Exit)

```env
BUY_LIMIT_PRICE=0.48      # Close to market price
SELL_IF_BELOW=0.30        # Wide stop-loss (hold longer)
BUY_AMOUNT_USD=20         # Larger size per side
```

## Profit/Loss Scenarios

### Scenario 1: One Side Wins

- **Entry**: Up @ 0.45, Down @ 0.45 (10 shares each = $9 total)
- **Outcome**: BTC goes up
- **Result**: 
  - Up position: 10 shares @ 1.0 = $10 (redeemed)
  - Down position: 10 shares @ 0.0 = $0 (worthless)
  - **Net**: $10 - $9 = **+$1 profit** (11% return)

### Scenario 2: Stop-Loss Triggers

- **Entry**: Up @ 0.45, Down @ 0.45 (10 shares each)
- **Price Action**: Up drops to 0.14, Down drops to 0.14
- **Result**:
  - Up: Stop-loss @ 0.13 → $1.30 recovered
  - Down: Stop-loss @ 0.13 → $1.30 recovered
  - **Net**: $2.60 - $9 = **-$6.40 loss** (71% loss, but limited by stop-loss)

### Scenario 3: Both Sides Hold to Resolution

- **Entry**: Up @ 0.45, Down @ 0.45 (10 shares each)
- **Outcome**: BTC goes up
- **Result**:
  - Up: Redeemed @ 1.0 = $10
  - Down: Worthless = $0
  - **Net**: $10 - $9 = **+$1 profit**

## Monitoring

### Key Metrics to Watch

1. **Fill Rate**: How often orders get filled on each side
2. **Stop-Loss Triggers**: Frequency of stop-loss executions
3. **Win Rate**: Percentage of markets where one side wins
4. **Average Profit/Loss**: Net result per market
5. **Redeem Success Rate**: Percentage of successful auto-redeems

### Log Messages

The bot logs key events:

```
[BUY] placed GTC limit buy Up @ 0.45 amountUsd=5 (elapsed=5s)
[BUY] placed GTC limit buy Down @ 0.45 amountUsd=5 (elapsed=5s)
[BUY] Up filled shares=11.11 @ 0.45
[BUY] Down filled shares=11.11 @ 0.45
[SELL] Up stop-loss (mid < 0.15) shares=11.11
[SELL] Down stop-loss (mid < 0.15) shares=11.11
[REDEEM] redeemed conditionId=0x1234...
```

## Troubleshooting

### Orders Not Filling

- **Price Too High**: 0.45 may be above market price at open
- **Timing**: Orders only placed in first 60 seconds
- **Market Conditions**: In trending markets, price may not reach 0.45

### Stop-Loss Not Triggering

- **Price Check**: Verify mid price calculation is working
- **Lag Too Large**: `SELL_LAG` may prevent fills if too large
- **Market End**: Position may be flattened before stop-loss

### Auto-Redeem Not Working

- **Resolution Delay**: Condition may not be resolved immediately
- **Network Issues**: Redeem requires on-chain transaction
- **Check Logs**: Review redeem attempt logs for errors

### Both Sides Filled

- **Expected Behavior**: Both sides can fill if price is near 0.45
- **Capital**: Ensure sufficient balance for 2x position size
- **Risk**: Understand that one side will lose (market-neutral strategy)

## Comparison with Other Bots

| Feature | v2 | v3 | v4 |
|---------|----|----|----|
| Entry Method | Market orders | GTD limit @ 0.35 | GTC limit @ 0.45 (both sides) |
| Sides Traded | One (predicted) | One (target/auto) | Both (Up + Down) |
| Prediction | ML/Ensemble | None | None |
| Risk Management | Velocity-based | None | Stop-loss only |
| Profit Management | Multi-stage profit lock | Fixed targets (0.4, 0.5) | Stop-loss only |
| Auto-Redeem | No | No | Yes |
| Capital Required | 1x | 1x | 2x |
| Complexity | High | Low | Medium |

## Related Documentation

- Main `README.md` - Overall system architecture
- `trade-bot-v2/README.md` - Advanced ML-powered bot
- `trade-bot-v3/README.md` - Simple limit buy strategy
