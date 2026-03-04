# Profit Protect System — Velocity, Prediction & Profit Lock

This document describes the full **profit protect system** in trade-bot-v2: how **prediction** (buy decision), **velocity risk**, and **profit lock** work together. It also lists all cases with detailed value examples (current config defaults).

---

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PREDICTION (buy)                                                       │
│  • bestAsk in (0.4, 0.8), ≥ 0.65 → candidate                           │
│  • Pick Up or Down by best ask; then shouldBuy(bestAsk, outcome)       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  VELOCITY GUARD (entry)                                                 │
│  • allowBuy: block only when velocity ADVERSE and |v| ≥ 15 $/s          │
│  • reduceSize: half size when adverse and |v| ≥ 8 $/s                  │
│  • (tightenProfitLock used later when in position)                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MARKET BUY → position opened                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  VELOCITY GUARD (in position)                                            │
│  • tightenProfitLock = (adverse & |v|≥5) OR (favorable & insufficient)  │
│  • insufficient = leftTime×velocity < 50 $ projected move               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PROFIT LOCK                                                            │
│  • Sell all above: if mid > 0.97 (configurable) → sell all (any case)  │
│  • Collapse: adverse≥0.10 AND velocityAdverse≠false → sell all         │
│  • T1 (0.88 @ entry 0.85): sell 30% at P1                              │
│  • T2 (0.925): sell 50% at P2                                          │
│  • Trail: sell rest when mid ≤ highWaterMark − D                        │
│  • Flatten: sell rest at 4.5 min (3.15 if tightened)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Prediction (buy) layer

**Role:** Decide *whether* and *which side* (Up or Down) to buy.

**Config (defaults):**
- `BUY_PRICE_MIN=0.4`, `BUY_PRICE_MAX=0.8`, `MIN_CONFIDENCE=0.65`, `BUY_SHARES=5`
- `PREDICTION_MIN_ELAPSED_SEC=150` (no buy in first 2.5 min of window)

**Logic:**
- Up/Down chosen by best ask in band and ≥ 0.65; prefer higher ask if both in band.
- `shouldBuy(bestAsk, outcome)` → buy when bestAsk in (0.4, 0.8) and bestAsk ≥ 0.65 (confidence = bestAsk).

**Output:** tokenId, outcome (Up/Down), bestAsk (entry price). No velocity here; velocity applies next.

---

## 3. Velocity layer

**Role:** Reduce risk when BTC is moving fast *against* the position; tighten exit when favorable but momentum is *insufficient* to reach target.

**Config (defaults):**
- `VELOCITY_BLOCK_USD_PER_SEC=15`, `VELOCITY_REDUCE_USD_PER_SEC=8`, `VELOCITY_TIGHTEN_USD_PER_SEC=5`
- `INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD=50`
- `VELOCITY_WINDOW_SEC=30`, `BTC_SAMPLE_INTERVAL_MS=10000`

**Direction:**
- **Up** position: adverse = velocity < 0 (BTC falling), favorable = velocity > 0.
- **Down** position: adverse = velocity > 0 (BTC rising), favorable = velocity < 0.

**At buy (outcome = side we’re buying):**
- **allowBuy:** false only when velocity is **adverse** and |velocity| ≥ 15 $/s.
- **reduceSize:** true when adverse and |velocity| ≥ 8 $/s and allowBuy → buy half size.
- `leftTimeSec` not used at buy.

**In position (outcome = position.outcome, leftTimeSec = endTime − now):**
- **tightenProfitLock:** true when:
  - (adverse and |velocity| ≥ 5 $/s), OR
  - (favorable and projected move = leftTimeSec × velocity in favorable direction < 50 $).

So: we only block/reduce when the move is against us; we tighten when either it’s against us or it’s with us but “not enough” to rely on reaching target.

---

## 4. Profit lock layer

**Role:** Decide when to sell (partial at T1/T2, or all via trail / collapse / flatten). Uses **tightenProfitLock** and **velocityAdverse** from the velocity layer.

**Config (defaults):**
- `PROFIT_LOCK_SELL_ALL_ABOVE=0.97` → if mid > 0.97, sell all (any case; checked first).
- `ALPHA1=0.20`, `ALPHA2=0.50` → P1 = entry + 0.20×(1−entry), P2 = entry + 0.50×(1−entry)
- `R1=0.30`, `R2=0.50` (fraction of *original* shares at T1/T2)
- `COLLAPSE_THRESHOLD=0.10`, `TRAIL_MIN=0.025`, `TRAIL_MAX=0.10`, `FLATTEN_BY_MIN=4.5`
- `FLATTEN_TIGHTEN_MULT=0.7`, `TRAIL_TIGHTEN_MULT=1.5`

**Order of checks (first match wins):**
1. **Sell all above:** mid > PROFIT_LOCK_SELL_ALL_ABOVE (default 0.97) → sell **all remaining** (any case).
2. **Collapse:** adverse ≥ 0.10 **and** velocityAdverse ≠ false → sell **all remaining** (market).
3. **T1:** mid ≥ P1 and !t1Hit → sell 30% of original at market.
4. **T2:** mid ≥ P2 and !t2Hit → sell 50% of original at market.
5. **Trail:** (t1Hit or (mid≥entry and hold≥30s)) and mid ≤ highWaterMark − D → sell all remaining.
6. **Flatten:** elapsedMin ≥ flattenByMin (4.5 or 3.15 if tightened) → sell all remaining.

**Collapse and velocity:** We only **collapse** when velocity is **adverse** (or unknown). When velocity is **favorable**, we do *not* collapse even if adverse ≥ 0.10; we let trail or flatten close the position so we don’t sell the low into a recovery.

**Tighten:** When tightenProfitLock is true, flatten at 3.15 min and trail D = (TRAIL_MIN×1.5 + TRAIL_MAX×1.5)/2 = 0.09375.

---

## 5. Code / logic audit notes

- **Collapse:** Signal carries `sizeRatio: 0.5` but run loop always sells **all remaining** on collapse (else branch). So collapse = full exit; the 0.5 is unused.
- **Velocity null:** When velocity is unavailable (no sampler or no data), velocityAdverse is undefined → profit lock still collapses at adverse ≥ 0.10 (safe default).
- **Buy guard:** When evaluating buy, we pass outcome = Up/Down so direction is always known; we don’t pass leftTimeSec so insufficient-momentum doesn’t apply at buy.
- **Sell price:** All sells are market; fill at best ask when the signal fires. “Sell at X” in docs means “trigger when mid is around X”; actual fill can be slightly worse.

---

## 6. All cases with detailed values (entry 0.85, current config)

**Entry:** 0.85  
**P1** = 0.85 + 0.20×0.15 = **0.88**, **P2** = **0.925**  
**Trail D** = 0.0625 (normal), 0.09375 (tightened)  
**Collapse trigger:** mid ≤ 0.75; **only** if velocityAdverse ≠ false.  
**Flatten:** 4.5 min from market start (3.15 if tightened).

### 6.1 Exit path cases (no velocity split)

| Case | Trigger 1 | Price (approx) | Trigger 2 | Price (approx) | Trigger 3 | Price (approx) |
|------|-----------|----------------|-----------|----------------|-----------|----------------|
| Collapse only | adverse≥0.10, velocity adverse | ~0.75 | — | — | — | — |
| Collapse only (velocity favorable) | — | — | Flatten at 4.5m | market | — | — |
| Flatten only | time ≥ 4.5m | market | — | — | — | — |
| Trail only | mid ≤ HWM−0.0625, canTrail | ~trail level | — | — | — | — |
| T1 → Flatten | T1 @ 0.88 | ~0.88 | Flatten | market | — | — |
| T1 → Trail | T1 @ 0.88 | ~0.88 | Trail | ~HWM−0.0625 | — | — |
| T1 → T2 → Flatten | T1, T2 | ~0.88, ~0.925 | Flatten | market | — | — |
| T1 → T2 → Trail | T1, T2 | ~0.88, ~0.925 | Trail | ~HWM−0.0625 | — | — |
| T1 → Collapse | T1 | ~0.88 | Collapse (velocity adverse) | ~0.75 | — | — |
| T1 → T2 → Collapse | T1, T2 | ~0.88, ~0.925 | Collapse | ~0.75 | — | — |

### 6.2 Velocity × scenario (detailed examples)

**Example A — Buy Up, velocity adverse (BTC falling), |v| = 20 $/s**
- allowBuy: false (adverse and 20 ≥ 15) → **[SKIP] buy blocked**
- If we had position: tightenProfitLock = true (adverse, 20 ≥ 5). Collapse allowed if mid ≤ 0.75.

**Example B — Buy Up, velocity favorable (BTC rising), |v| = 12 $/s**
- allowBuy: true. reduceSize: false. → Buy full size.
- In position: tightenProfitLock = false (unless insufficient momentum). No collapse when in drawdown if velocity stays favorable.

**Example C — In position (Up), mid = 0.74, velocity favorable**
- adverse = 0.85 − 0.74 = 0.11 ≥ 0.10. velocityAdverse = false → **no collapse**. Next: T1/T2 not hit, trail may not be active yet. Eventually **flatten** at 4.5 min (or trail if HWM and canTrail later).

**Example D — In position (Up), mid = 0.74, velocity adverse**
- adverse ≥ 0.10, velocityAdverse = true → **collapse** → sell all at ~0.75.

**Example E — Favorable but insufficient momentum**
- Up, velocity = +2 $/s, leftTimeSec = 20 s → projectedMove = 40 $ < 50 → tightenProfitLock = true.
- Flatten at 3.15 min, trail D = 0.09375.

**Example F — Entry 0.85, T1 then trail (numbers)**
- Buy 10 @ 0.85. Mid reaches 0.88 → sell 3 @ ~0.88. highWaterMark = 0.90 → trail level = 0.8375. Mid drops to 0.83 → sell 7 @ ~0.83.
- P&L: 3×(0.88−0.85) + 7×(0.83−0.85) = 0.09 − 0.14 = −0.05 (example; actual fill at best ask).

**Example G — Entry 0.85, drawdown 0.11 but velocity favorable**
- Mid = 0.74, velocitySigned = +5 (BTC rising). No collapse. Position stays until trail or flatten; if time reaches 4.5 min, flatten at market (e.g. 0.76).

---

## 7. Summary table (when we sell and at what price, entry 0.85)

| Exit | Condition | Sell price (trigger level) |
|------|-----------|----------------------------|
| Collapse | adverse ≥ 0.10 **and** velocity adverse | ~0.75 (all remaining) |
| T1 | mid ≥ 0.88, first time | ~0.88 (30% of original) |
| T2 | mid ≥ 0.925, first time after T1 | ~0.925 (50% of original) |
| Trail | mid ≤ HWM − D, canTrail | ~(HWM − 0.0625) or 0.09375 if tightened |
| Flatten | elapsedMin ≥ 4.5 (or 3.15) | market at that time |

This is the full **profit protect system**: prediction chooses side and entry, velocity guards entry and sets tighten/velocityAdverse in position, and profit lock (with collapse only when velocity adverse) decides when we sell and at which approximate price in every case.
