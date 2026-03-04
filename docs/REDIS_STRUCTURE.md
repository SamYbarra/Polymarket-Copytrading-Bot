# Redis structure (Polymarket BTC 5m tracker)

All keys are stored in the same Redis instance (no logical “database” separation). Config: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.

---

## 1. Per-market keys (one set per `conditionId`)

`conditionId` = Polymarket condition ID for a 5m market (e.g. `0x1234...`).

### 1.1 Wallets (Hash)

| Key | Type | TTL | Description |
|-----|------|-----|-------------|
| `market:{conditionId}:wallets` | **Hash** | none | Per-wallet buy state for this market. |

**Hash layout:**
- **Field:** wallet address (e.g. `0xabc...`)
- **Value:** JSON string of one `WalletTradeData` object:

```json
{
  "wallet": "0x...",
  "totalBuyUsd": 150.5,
  "buyUpCount": 2,
  "buyDownCount": 0,
  "buyUpUsd": 150.5,
  "buyDownUsd": 0,
  "lastBuyTime": 1730000000
}
```

- **List all markets:** `KEYS market:*:wallets` → conditionIds are derived by stripping `market:` and `:wallets`.

---

### 1.2 BTC open price (String)

| Key | Type | TTL | Description |
|-----|------|-----|-------------|
| `market:{conditionId}:btc_open` | **String** | 3600 s | BTC USD price at market open (Binance 1m kline). |

- **Value:** decimal string, e.g. `"97234.50"`.

---

### 1.3 Current hot wallet (String)

| Key | Type | TTL | Description |
|-----|------|-----|-------------|
| `market:{conditionId}:current_hot_wallet` | **String** | none | Reserved for “current hot wallet” signal (if used). |

- Deleted together with the market when the market is finalized (`deleteMarket`).

---

## 2. Global keys (not per-market)

### 2.1 Proxy wallet balance (String)

| Key | Type | TTL | Description |
|-----|------|-----|-------------|
| `proxy_wallet_balance_usd` | **String** | 120 s | Last known proxy wallet balance in USD. |

- **Value:** decimal string, e.g. `"1234.56"`.

---

## 3. Key patterns summary

| Pattern | Type | Example key |
|---------|------|-------------|
| `market:{conditionId}:wallets` | Hash (wallet → JSON) | `market:0xabc...:wallets` |
| `market:{conditionId}:btc_open` | String | `market:0xabc...:btc_open` |
| `market:{conditionId}:current_hot_wallet` | String | `market:0xabc...:current_hot_wallet` |
| `proxy_wallet_balance_usd` | String | `proxy_wallet_balance_usd` |

---

## 4. Lifecycle

- **New market:** Tracker creates `market:{conditionId}:wallets` (empty or from positions sync) and `market:{conditionId}:btc_open` when it starts tracking.
- **Market ends:** Tracker calls `deleteMarket(conditionId)` and removes:
  - `market:{conditionId}:wallets`
  - `market:{conditionId}:btc_open`
  - `market:{conditionId}:current_hot_wallet`
- **List “active” markets:** `KEYS market:*:wallets` then strip prefix/suffix to get conditionIds.

---

## 5. Inspect with redis-cli

```bash
# List all wallet keys (one per active market)
KEYS market:*:wallets

# For one market (replace CONDITION_ID)
HGETALL market:CONDITION_ID:wallets
GET market:CONDITION_ID:btc_open

# Proxy balance
GET proxy_wallet_balance_usd
```

Each `HGETALL` value is a JSON object; parse it to see `wallet`, `totalBuyUsd`, `buyUpUsd`, `buyDownUsd`, etc.
