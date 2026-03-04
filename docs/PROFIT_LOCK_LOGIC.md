# Profit Lock Logic — Plain Explanation

Profit lock is the logic that **partially or fully sells** your position **before** the 5‑minute market resolves, so you lock in profit or cut loss instead of holding to the binary outcome.

---

## 1. What we track per position

After you buy, we keep a **position state** for that market:

| Field | Meaning |
|-------|--------|
| `entryPrice` | Price you bought at (best ask at buy time). |
| `confidence` | Model confidence at buy (e.g. 0.72). |
| `shares` | Original size; we also track `remainingShares` after partial sells. |
| `t1Hit` | Have we already sold the “T1” (first target) slice? |
| `t2Hit` | Have we already sold the “T2” (second target) slice? |
| `highWaterMark` | Highest **mid price** we’ve seen since buy (used for trailing). |

Each cycle we get the **current mid** (and book), update `highWaterMark` if mid is higher, then run the evaluator once.

---

## 2. One decision per cycle: priority order

The evaluator runs **once per cycle** (main tracker: each poll; realtime bot: every ~150 ms). It returns **one action**: the **first** condition in this list that is true:

1. **Collapse** — price dropped a lot → sell 50% immediately.
2. **T1** — price reached first target and we haven’t sold T1 yet → sell tactical slice (r1).
3. **T2** — price reached second target and we haven’t sold T2 yet → sell core slice (r2).
4. **T3** — (low vol only) price reached third target → sell the rest.
5. **Trail** — we’re in “trailing mode” and price fell below trail level → sell (trailing stop).
6. **Time** — we’re past “flatten by” time (e.g. 4.5 min) → sell remaining.
7. **Hold** — none of the above → do nothing.

So: **collapse > T1 > T2 > T3 > trail > time > hold**.

---

## 3. How target prices are defined

We don’t use fixed price levels; we use **fractions of the max payoff** from your entry.

- Max payoff per share if you win at resolution: **1 − entryPrice** (e.g. entry 0.42 → max payoff 0.58).
- We define three fractions: **α1**, **α2**, **α3** (e.g. 0.20, 0.50, 0.75).

**Target price formula:**

```text
target = entryPrice + α × (1 − entryPrice)
```

So:

- **T1**: P_t1 = entry + α1 × (1 − entry)  →  e.g. 0.42 + 0.20×0.58 = 0.536  
- **T2**: P_t2 = entry + α2 × (1 − entry)  →  e.g. 0.42 + 0.50×0.58 = 0.71  
- **T3**: P_t3 = entry + α3 × (1 − entry)  →  e.g. 0.42 + 0.75×0.58 = 0.855  

We **sell** when **mid ≥ target** (for the token you hold — same for Up or Down outcome).  
α1/α2/α3 are adjusted by **vol regime** (low vol: slightly tighter targets; high vol: slightly wider so we don’t get whipsawed).

---

## 4. What each action does (sizes)

| Action | What we sell | Typical params |
|--------|----------------|-----------------|
| **exit_collapse** | 50% of remaining | `sizeRatio: 0.5` |
| **sell_partial_t1** | **r1** of **original** shares (e.g. 30%) | `r1 = 0.30` |
| **sell_partial_t2** | **r2** of **original** shares (e.g. 50%) | `r2 = 0.50` |
| **sell_partial_t3** | All remaining | `sizeRatio: 1` |
| **sell_trail** | All remaining (trailing stop) | — |
| **flatten_remaining** | All remaining (time decay) | — |

So you first lock a **tactical** piece at T1 (e.g. 30%), then a **core** piece at T2 (e.g. 50%), and the rest is either sold at T3 (low vol), by the trailing stop, or by the time‑decay exit.

---

## 5. Trailing logic (simplified)

Trailing only runs **after** either:

- we’ve already hit T1 (`t1Hit`), or  
- we’re in profit and have been holding at least 30 seconds.

Then we define a **trail level**:

```text
trailLevel = highWaterMark − D
```

- **highWaterMark** = highest mid we’ve seen (updated every cycle when mid > highWaterMark).
- **D** = distance in price (e.g. 0.025–0.10), scaled by vol regime and a bit by confidence.

If **mid ≤ trailLevel** → we fire **sell_trail** and sell the rest. So we’re “trailing” the market: we only sell when price **drops** from its high by at least D.

---

## 6. Time decay

The 5‑minute market has a fixed end. We don’t want to hold a big position into the last seconds. So we have a **flatten by** time (e.g. **4.5 minutes** after market start):

- When **minutesElapsed ≥ flattenByMin** → action **flatten_remaining** → sell whatever is left.

That’s the “time decay” layer: by 4.5 min we exit the remainder regardless of price.

---

## 7. Collapse (emergency)

If the **outcome token price drops a lot** from our entry (e.g. **entryPrice − mid ≥ 0.10**), we treat it as a possible collapse and **exit 50%** immediately (`exit_collapse`). So we react fast to a big adverse move instead of waiting for T1/T2/trail.

---

## 8. Where it runs

- **Main tracker**: each **processCycle** (e.g. every 30 s), for the current market, if we have an open position we run the evaluator once; if action ≠ hold we call the sell service and update position state.
- **Realtime bot**: same evaluator runs on a **fast loop** (e.g. every 150 ms) so we react quickly to price moves (partials and trailing).

So the **logic** is the same in both; only the **frequency** of evaluation differs (polling vs realtime loop).

---

## 9. Default numbers (5m BTC)

| Param | Default | Meaning |
|-------|---------|--------|
| α1 | 0.20 | First target = 20% of max payoff above entry. |
| α2 | 0.50 | Second target = 50% of max payoff. |
| α3 | 0.75 | Third target (low vol only) = 75%. |
| r1 | 0.30 | Sell 30% of position at T1. |
| r2 | 0.50 | Sell 50% of position at T2. |
| trailMin / trailMax | 0.025, 0.10 | Min/max distance for trail below high water mark. |
| collapseThreshold | 0.10 | Exit 50% if price drops 10% from entry. |
| flattenByMin | 4.5 | Sell rest by 4.5 min elapsed. |

Full spec and formulas: **docs/PROFIT_LOCK_ENGINE.md**.  
Code: **src/services/profit-lock/evaluator.ts** (one function: `evaluateProfitLock`).
