# Velocity Risk Control and Its Effect on Profit Lock

## Direction-aware + insufficient momentum

- **Direction-aware:** Risk (block / reduce / tighten) applies only when velocity is **adverse** for the position: Up + BTC falling (velocity < 0), or Down + BTC rising (velocity > 0). Favorable velocity does not trigger block/reduce/tighten by magnitude alone.
- **Insufficient momentum:** When velocity is **favorable** but projected move `leftTime × velocity` is **below** `INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD` (default 50 $), we set **tightenProfitLock** so the position exits sooner (earlier flatten + tighter trail) instead of waiting for target.

---

## What is velocity?

**Velocity** = how fast BTC price is moving, in **dollars per second** ($/s).

- **Source:** Binance BTC/USD price, sampled every `BTC_SAMPLE_INTERVAL_MS` (default 10s).
- **Window:** Last `VELOCITY_WINDOW_SEC` (default 30s). Velocity = (latest price − price from window ago) / elapsed seconds.
- **Sign:** The bot uses **absolute** velocity: both big moves **up** and **down** count as “fast” (risk).

So: **high |velocity|** = BTC is moving a lot in a short time = volatile = risk layer reacts.

---

## How velocity controls risk (velocity guard)

The guard turns velocity into three **on/off** decisions every loop:

| Output | Meaning | When it’s true (defaults) |
|--------|---------|---------------------------|
| **allowBuy** | May we open a new position? | Not (adverse **and** \|velocity\| ≥ 15 $/s). Favorable velocity does not block. |
| **reduceSize** | Should we buy half size? | Adverse **and** \|velocity\| ≥ 8 $/s **and** allowBuy |
| **tightenProfitLock** | Exit sooner / trail more? | Adverse **and** \|velocity\| ≥ 5 $/s, **or** favorable but insufficient momentum (see below) |

**Config (defaults):** At ~$100k BTC, 5 $/s ≈ $150 move in 30s (0.15%), 15 $/s ≈ 0.45%.

- `VELOCITY_BLOCK_USD_PER_SEC = 15` → block new buys if velocity ≥ 15 $/s.
- `VELOCITY_REDUCE_USD_PER_SEC = 8` → if we still allow buy, use half size when velocity ≥ 8 $/s.
- `VELOCITY_TIGHTEN_USD_PER_SEC = 5` → when velocity ≥ 5 $/s, set `tightenProfitLock = true` for profit lock.

So:

- **Low velocity (< 5 $/s):** allow buy, full size, normal profit lock.
- **Medium (5–15 $/s):** allow buy, **reduced size** from 8 $/s up, **tightened** profit lock from 5 $/s up.
- **High (≥ 15 $/s):** **no new buys**; existing positions still use **tightened** profit lock.

---

## Where the guard is used (run loop)

1. **When we have a position**  
   - `guard = evaluateVelocityGuard(velocityAbs)`  
   - Profit lock is called with `tightenProfitLock: guard.tightenProfitLock`  
   - So: **existing positions** get tighter exits when velocity is high.

2. **When we might buy**  
   - Same `guard`.  
   - If `!guard.allowBuy` → skip buy, log `[SKIP] buy blocked: velocity …`.  
   - If `guard.reduceSize` → `buyShares = max(1, floor(BUY_SHARES/2))`, log `[RISK] velocity … reduced size …`.

So velocity affects:
- **Entry:** block or reduce size.
- **Existing position:** only via **tightenProfitLock** (no separate “force exit” from velocity; collapse/trail/flatten still decide).

---

## Effect of velocity on the profit lock system

**Only** when `tightenProfitLock === true` (adverse velocity ≥ 5 $/s, or favorable but insufficient momentum), profit lock uses **tighter** time and trail:

### 1. Flatten earlier (time exit)

- **Normal:** flatten when `elapsedMin >= FLATTEN_BY_MIN` (e.g. 4.5 min).
- **Tightened:** flatten when `elapsedMin >= FLATTEN_BY_MIN * FLATTEN_TIGHTEN_MULT` (default 0.7 → **3.15 min**).

So in volatile markets we **exit by time sooner**, reducing exposure near resolution.

### 2. Trail distance larger (trail triggers sooner)

- **Normal:** trail distance `D = (TRAIL_MIN + TRAIL_MAX) / 2` (e.g. (0.025 + 0.10)/2 = 0.0625).  
  Trail level = highWaterMark − D.
- **Tightened:** `D = (TRAIL_MIN * TRAIL_TIGHTEN_MULT + TRAIL_MAX * TRAIL_TIGHTEN_MULT) / 2`  
  Default `TRAIL_TIGHTEN_MULT = 1.5` → D is **1.5×** larger → trail level is **further below** the high → we need a **smaller pullback** for the trail to hit → **trail triggers sooner**, locking profit earlier.

So in volatile markets we **lock profit with the trail sooner** (more sensitive to pullbacks).

### What does *not* change with velocity

- **T1 / T2** targets (P1, P2) and **R1, R2** are unchanged.
- **Collapse** threshold is unchanged.
- **Logic order** (collapse → T1 → T2 → trail → flatten) is unchanged.

---

## Summary diagram

```
Velocity (|ΔBTC| / time, $/s)   [at ~$100k BTC: 5 $/s ≈ 0.15% in 30s, 15 $/s ≈ 0.45%]
         │
         ├─ < 5 $/s   → allowBuy, full size, normal profit lock (flatten 4.5m, trail D normal)
         │
         ├─ 5–15 $/s  → allowBuy, REDUCE SIZE from 8 $/s, TIGHTEN profit lock from 5 $/s
         │                    → flatten at 3.15m, trail D × 1.5 (trail sooner)
         │
         └─ ≥ 15 $/s  → BLOCK BUY, existing positions still TIGHTEN profit lock
                              → same earlier flatten + sooner trail
```

**Insufficient momentum:** For an existing position, projected move = `leftTimeSec × velocity` (in $, in the favorable direction). If this is **&lt; INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD** (default 50), we set tightenProfitLock so we don’t wait for target and exit earlier.

**In one line:** Velocity **blocks or shrinks new buys only when adverse**; **tightens existing positions** when adverse or when favorable but projected move is too small.
