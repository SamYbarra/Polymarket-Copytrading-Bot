# Polymarket Copy Trading Bot

A copy trading bot for Polymarket that mirrors trades from target wallets in real time. Built with TypeScript: WebSocket or API polling for trade detection, Polymarket CLOB for execution, with risk controls and optional auto-redemption.

---

## Table of contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick start: run the bot in 5 steps](#quick-start-run-the-bot-in-5-steps)
- [How to run the bot](#how-to-run-the-bot)
- [How to set environment variables (.env)](#how-to-set-environment-variables-env)
- [Target wallets (config.json)](#target-wallets-configjson)
- [Environment variable reference](#environment-variable-reference)
- [Scripts reference](#scripts-reference)
- [Project structure](#project-structure)
- [Security & disclaimer](#security--disclaimer)

---

## Overview

- **Real-time trade mirroring** – Monitors target wallets via WebSocket or API and copies their trades.
- **Configurable sizing** – Per-wallet order size in `src/config/config.json` (USDC or token amount).
- **Risk management** – Buy threshold, stop-loss (SELL_PRICE), take-profit (PROFIT_SELL_THRESHOLD).
- **Auto-redemption** – Optional scheduled redemption of resolved positions.
- **Telegram** – Optional notifications when target wallets trade.

---

## Prerequisites

Before you start, ensure you have:

| Requirement | Details |
|-------------|---------|
| **Node.js** | Version 18 or higher. Check with `node -v`. |
| **npm** | Comes with Node.js. Check with `npm -v`. |
| **Polygon wallet** | A wallet (e.g. MetaMask) on Polygon with some USDC for trading. |
| **Polymarket account** | You need your **proxy (smart) wallet** address from Polymarket (see [Finding your proxy wallet](#finding-your-proxy-wallet)). |

---

## Quick start: run the bot in 5 steps

1. **Clone and install**
   ```bash
   cd Polymarket-Copytrading-Bot
   npm install
   ```

2. **Create your `.env` file**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` – set these required values**
   - `PRIVATE_KEY` – Your wallet private key (e.g. from MetaMask: Account → three dots → Account details → Export Private Key). Must start with `0x`.
   - `PROXY_WALLET_ADDRESS` – Your Polymarket proxy wallet address (see [Finding your proxy wallet](#finding-your-proxy-wallet)).
   - `DRY_RUN=false` – So the bot places real orders (set `true` to only log, no orders).

4. **Edit `src/config/config.json` – add target wallets**
   - Add the Polymarket wallet addresses you want to copy. The number is the order size (tokens or USDC depending on `ORDER_SIZE_IN_TOKENS`).
   ```json
   {
       "0xAddressOfTrader1": 1,
       "0xAddressOfTrader2": 5
   }
   ```

5. **Run the bot**
   ```bash
   npm start
   ```
   Or use API polling instead: `npm run copytrade`.

On first run, the bot will create `src/data/credential.json` (Polymarket API credentials). Keep that file and `.env` secret and never commit them.

---

## How to run the bot

### Two ways to run copy trading

| Mode | Command | When to use |
|------|---------|-------------|
| **WebSocket** | `npm start` | Real-time; uses Polymarket’s live feed. Best for low latency. |
| **API polling** | `npm run copytrade` | Fetches trades on an interval (default 30s). Simpler, no WebSocket. |

Both use the same `.env` and `src/config/config.json`. Use one at a time.

### Step-by-step: first run

1. **Install dependencies** (once)
   ```bash
   npm install
   ```

2. **Copy and fill `.env`**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set at least:
   - `PRIVATE_KEY=0x...` (your EOA private key)
   - `PROXY_WALLET_ADDRESS=0x...` (your Polymarket proxy)
   - `DRY_RUN=false` (to allow real buy/sell)

3. **Add target wallets** in `src/config/config.json`  
   Format: `"0xWalletAddress": number`. The number is the size per copy-trade (see [Target wallets](#target-wallets-configjson)).

4. **Optional: test without placing orders**  
   Set `DRY_RUN=true` in `.env`, then run the bot. It will log what it would do but not send orders.

5. **Start the bot**
   ```bash
   npm start
   ```
   or
   ```bash
   npm run copytrade
   ```

6. **First-run behaviour**
   - If `src/data/credential.json` is missing, the bot creates it (Polymarket API key).
   - It may prompt or run allowance/balance checks. Ensure your proxy wallet has USDC and approvals on Polygon.

### Other useful commands

- **Check wallet and balance** (no trading):
  ```bash
  npm run balance
  ```
- **Monitor one wallet** (log trades only, no copying):
  ```bash
  npm run monitor
  ```
- **Auto-redeem** resolved positions:
  ```bash
  npm run auto-redeem
  ```
- **Clear copy-trade history** (e.g. to reprocess old trades):
  ```bash
  npm run clear-history
  ```

---

## How to set environment variables (.env)

The bot reads configuration from a `.env` file in the project root. Never commit `.env` or share it.

### Creating `.env`

```bash
cp .env.example .env
```

Then open `.env` in a text editor and replace the placeholder values.

### Required variables (must set)

| Variable | Example | Description |
|----------|---------|-------------|
| `PRIVATE_KEY` | `0xabc123...` | Your wallet (EOA) private key. Used to sign every order. Export from MetaMask (Account → ⋮ → Account details → Export Private Key). **Keep secret.** |
| `PROXY_WALLET_ADDRESS` | `0x875058B4...` | Your Polymarket proxy (smart) wallet address. This is where the exchange holds your positions. Required for the CLOB client. |

#### Finding your proxy wallet

- **Option A:** In the Polymarket app or website, go to your profile / account or deposit/withdraw. The proxy address is often shown there (it’s the “smart wallet” or “proxy” address).
- **Option B:** Set only `PRIVATE_KEY` in `.env`, run `npm run balance`. The script can derive and print the proxy address for your EOA; then copy it into `PROXY_WALLET_ADDRESS` in `.env`.

### Enabling real buy/sell orders

| Variable | Value | Effect |
|----------|--------|--------|
| `DRY_RUN` | `false` | Bot **places real orders** (buy/sell). |
| `DRY_RUN` | `true` or unset | Bot **only logs**; no orders are sent. Safe for testing. |

Set `DRY_RUN=false` in `.env` when you want the bot to actually trade.

### Copy-trading switch

| Variable | Value | Effect |
|----------|--------|--------|
| `ENABLE_COPY_TRADING` | `true` or unset | Copy trading is **on** (bot will copy target wallets). |
| `ENABLE_COPY_TRADING` | `false` | Copy trading is **off** (e.g. only monitor or redeem). |

### Chain and RPC

| Variable | Example | Description |
|----------|---------|-------------|
| `CHAIN_ID` | `137` | `137` = Polygon mainnet (production). `80002` = Amoy testnet. |
| `RPC_URL` | `https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY` | Full RPC URL. Use `https` (not `wss`). If set, `RPC_TOKEN` is ignored. |
| `RPC_TOKEN` | `your_alchemy_key` | If `RPC_URL` is not set, the bot builds the RPC URL using this (e.g. Alchemy API key). |

You can leave RPC unset; the bot has default endpoints (rate limits may apply).

### Trading behaviour

| Variable | Example | Description |
|----------|---------|-------------|
| `ORDER_TYPE` | `FAK` | `FAK` (fill-and-kill) or `FOK` (fill-or-kill). |
| `TICK_SIZE` | `0.01` | Price step: `0.1`, `0.01`, `0.001`, or `0.0001`. |
| `ORDER_SIZE_IN_TOKENS` | `true` | If `true`, numbers in `config.json` = **token count**. If `false`, they’re treated as **USDC** (or balance-based). |
| `ORDER_SIZE_IN_USDC` | `true` | If `true`, `config.json` numbers = fixed **USDC** amount (no price fetch). |

### Risk and thresholds

| Variable | Example | Description |
|----------|---------|-------------|
| `BUY_THRESHOLD` | `0.45` | Only copy a **BUY** when the token’s price is **above** this (e.g. 0.45 = 45¢). |
| `SELL_PRICE` | `0.35` | **Stop-loss:** sell when token price goes **below** this. |
| `PROFIT_SELL_THRESHOLD` | `0.99` | **Take-profit:** sell when token price reaches this (e.g. 0.99). |
| `PENDING_BUY_TIME_THRESHOLD_SECONDS` | `160` | For “pending” buys: only buy after this many seconds past the 5m boundary. |

### Slippage and retries

| Variable | Example | Description |
|----------|---------|-------------|
| `BUY_SLIPPAGE_BPS` | `200` | Buy slippage in basis points (200 = 2%). |
| `SELL_SLIPPAGE_BPS` | `100` | Sell slippage in basis points (100 = 1%). |
| `ORDER_RETRY_ATTEMPTS` | `5` | How many times to retry placing an order. |
| `ORDER_RETRY_DELAY_MS` | `200` | Delay between retries (ms). |

### API polling (for `npm run copytrade`)

| Variable | Example | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | `30000` | How often to fetch new trades (ms). 30000 = 30 seconds. |
| `WALLET_FETCH_DELAY_MS` | `800` | Delay between each target wallet request (rate limiting). |

### Optional: Telegram

| Variable | Example | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | `123456:ABC...` | Bot token from [@BotFather](https://t.me/BotFather). Leave empty to disable. |
| `TELEGRAM_CHAT_ID` | `7744299798` | Chat ID to receive alerts. Leave empty to disable. |

When both are set, the bot can send a notification when a target wallet trades.

### Optional: auto-redeem and CLOB

| Variable | Example | Description |
|----------|---------|-------------|
| `REDEEM_DURATION` | `120` | Run auto-redeem every N minutes. Empty or 0 = disabled. |
| `CLOB_API_URL` | `https://clob.polymarket.com` | CLOB API base URL. Default is production. |

### Debug

| Variable | Example | Description |
|----------|---------|-------------|
| `DEBUG` | `true` | Enable extra debug logging. |

### Minimal `.env` example (real orders)

```env
PRIVATE_KEY=0xYourPrivateKeyHere
PROXY_WALLET_ADDRESS=0xYourPolymarketProxyAddress
DRY_RUN=false
ENABLE_COPY_TRADING=true
```

Everything else can be omitted to use defaults, or copy from `.env.example` and adjust.

---

## Target wallets (config.json)

**Target wallets are not in `.env`.** They are configured in **`src/config/config.json`**.

### Format

```json
{
    "0xWalletAddressToCopy1": 1,
    "0xWalletAddressToCopy2": 5
}
```

- **Key** – Polymarket wallet address (proxy or EOA) of the trader you want to copy.
- **Value** – Number: order size per copy-trade.
  - If `ORDER_SIZE_IN_TOKENS=true` (default): size = **number of tokens** to buy/sell.
  - If `ORDER_SIZE_IN_TOKENS=false`: size = **USDC** amount (or balance-based depending on config).

### Where to get target addresses

Use the Polymarket profile or activity URL of the trader; the address shown there (often the proxy) is what you put in `config.json`. The bot matches trades by this address.

### Example

Copy two traders: one with 1 token per trade, one with 5 tokens per trade:

```json
{
    "0xaac8e98e05cf679616dec6c47755748b4cb0bff1": 1,
    "0x4c353dd347c2e7d8bcdc5cd6ee569de7baf23e2f": 5
}
```

Save the file; the bot reads it on startup. No need to restart for every edit if you only change config occasionally (restart after editing for changes to apply).

---

## Environment variable reference

Quick reference for all supported variables. See [How to set environment variables](#how-to-set-environment-variables-env) for details.

| Variable | Required | Default | Description |
|----------|----------|--------|-------------|
| `PRIVATE_KEY` | Yes | — | EOA private key. |
| `PROXY_WALLET_ADDRESS` | Yes | — | Polymarket proxy wallet. |
| `DRY_RUN` | No | `true` | `false` = place orders; `true` = log only. |
| `ENABLE_COPY_TRADING` | No | `true` | `false` = disable copy trading. |
| `CHAIN_ID` | No | `137` | `137` = Polygon mainnet, `80002` = Amoy. |
| `RPC_URL` | No | — | Full RPC URL (https). |
| `RPC_TOKEN` | No | — | e.g. Alchemy key to build RPC URL. |
| `CLOB_API_URL` | No | `https://clob.polymarket.com` | CLOB API base. |
| `ORDER_TYPE` | No | `FAK` | `FAK` or `FOK`. |
| `TICK_SIZE` | No | `0.01` | `0.1`, `0.01`, `0.001`, `0.0001`. |
| `NEG_RISK` | No | `false` | Negative-risk exchange. |
| `ORDER_SIZE_IN_TOKENS` | No | `true` | config.json = token count. |
| `ORDER_SIZE_IN_USDC` | No | `false` | config.json = fixed USDC. |
| `BUY_THRESHOLD` | No | `0.5` | Min price to copy a BUY. |
| `SELL_PRICE` | No | `0.45` | Sell when price below this. |
| `PROFIT_SELL_THRESHOLD` | No | `0.98` | Sell when price ≥ this. |
| `PENDING_BUY_TIME_THRESHOLD_SECONDS` | No | `210` | Pending buy delay (seconds). |
| `BUY_SLIPPAGE_BPS` | No | `200` | Buy slippage (bps). |
| `SELL_SLIPPAGE_BPS` | No | `100` | Sell slippage (bps). |
| `ORDER_RETRY_ATTEMPTS` | No | `5` | Order retries. |
| `ORDER_RETRY_DELAY_MS` | No | `200` | Retry delay (ms). |
| `POLL_INTERVAL_MS` | No | `30000` | API poll interval (ms). |
| `WALLET_FETCH_DELAY_MS` | No | `800` | Delay between wallet fetches (ms). |
| `USER_REAL_TIME_DATA_URL` | No | `wss://ws-live-data.polymarket.com` | WebSocket URL. |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token. |
| `TELEGRAM_CHAT_ID` | No | — | Telegram chat ID. |
| `REDEEM_DURATION` | No | — | Auto-redeem interval (minutes). |
| `DEBUG` | No | `false` | Extra logging. |

---

## Scripts reference

| Command | Description |
|---------|-------------|
| `npm start` | WebSocket copy-trade bot (real-time). |
| `npm run copytrade` | API polling copy-trade bot. |
| `npm run monitor` | Monitor one wallet (no copying). |
| `npm run balance` | Show EOA, proxy, and USDC balances. |
| `npm run auto-redeem` | Auto-redeem resolved positions. |
| `npm run clear-history` | Clear processed-trades / bought/sold history. |
| `npm run redeem` | Manual redeem (CONDITION_ID / INDEX_SETS in script or env). |
| `npm run manual-add-holdings` | Add holdings to token-holding.json. |
| `npm run sync-holdings` | Sync holdings from wallet. |

---

## Project structure

```
polymarket-copytrading-bot-ts/
├── .env                    # Your secrets (create from .env.example)
├── .env.example            # Template for .env
├── package.json
├── src/
│   ├── index.ts            # WebSocket copy-trade entry (npm start)
│   ├── copytrade.ts    # API copy-trade entry (npm run copytrade)
│   ├── auto-redeem-copytrade.ts
│   ├── config/
│   │   ├── env.ts          # Reads .env
│   │   └── config.json     # Target wallets + sizes
│   ├── copy-trade/
│   │   ├── core.ts         # processTrade() – shared copy logic
│   │   └── risk-manager.ts
│   ├── data/
│   │   ├── credential.json # API credentials (auto-created)
│   │   └── token-holding.json
│   ├── providers/
│   │   ├── clobclient.ts   # CLOB (uses PRIVATE_KEY + PROXY_WALLET_ADDRESS)
│   │   └── wssProvider.ts
│   ├── security/
│   │   ├── createCredential.ts
│   │   └── allowance.ts
│   ├── other/
│   │   ├── redeem.ts
│   │   ├── monitor-wallet.ts
│   │   └── wallet-balance.ts
│   └── utils/
│       ├── proxyWallet.ts
│       ├── balance.ts
│       └── redeem.ts
└── README.md
```

---
