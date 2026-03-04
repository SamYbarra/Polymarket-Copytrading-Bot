# Profit Protect System — All Cases with Detailed Values

Entry **0.85**, **10 shares**, current config. All sells at **market** (best ask at trigger time). Velocity: signed $/s (positive = BTC up, negative = BTC down).

---

## Config snapshot (defaults)

| Parameter | Value |
|----------|--------|
| ALPHA1, ALPHA2 | 0.20, 0.50 → P1=0.88, P2=0.925 |
| R1, R2 | 0.30, 0.50 |
| COLLAPSE_THRESHOLD | 0.10 (mid ≤ 0.75) |
| TRAIL_MIN, TRAIL_MAX | 0.025, 0.10 → D = 0.0625 |
| FLATTEN_BY_MIN | 4.5 (3.15 if tightened) |
| VELOCITY_BLOCK_USD_PER_SEC | 15 |
| VELOCITY_REDUCE_USD_PER_SEC | 8 |
| VELOCITY_TIGHTEN_USD_PER_SEC | 5 |
| INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD | 50 |

---

## Part 1: Buy decision (prediction + velocity)

| # | upAsk | downAsk | outcome | velocity ($/s) | velocity dir vs outcome | allowBuy | reduceSize | Result |
|---|-------|---------|---------|-----------------|--------------------------|----------|------------|--------|
| B1 | 0.72 | 0.28 | Up | null | — | yes | no | Buy full size |
| B2 | 0.72 | 0.28 | Up | −18 | adverse | no | — | [SKIP] buy blocked |
| B3 | 0.72 | 0.28 | Up | −10 | adverse | yes | yes (10≥8) | Buy half size (e.g. 2 or 3) |
| B4 | 0.72 | 0.28 | Up | +12 | favorable | yes | no | Buy full size |
| B5 | 0.28 | 0.72 | Down | +20 | adverse | no | — | [SKIP] buy blocked |
| B6 | 0.28 | 0.72 | Down | −8 | favorable | yes | no | Buy full size |

---

## Part 2: In position — velocity → tighten / collapse

**Position:** Up, entry 0.85, 10 shares.

| # | mid | velocity ($/s) | leftTimeSec | adverse (0.85−mid) | velocityAdverse | tightenProfitLock | Collapse? | Next exit if no collapse |
|----|-----|----------------|-------------|--------------------|-----------------|--------------------|-----------|---------------------------|
| P1 | 0.74 | −5 | 120 | 0.11 | true | true (adverse ≥5) | **Yes** | — |
| P2 | 0.74 | +3 | 120 | 0.11 | false | false (no insufficient: 360≥50) | **No** | Flatten or trail later |
| P3 | 0.74 | +1 | 30 | 0.11 | false | true (insufficient: 30<50) | **No** | Flatten at 3.15m |
| P4 | 0.80 | −10 | 90 | 0.05 | true | true | No (adverse<0.10) | T1/T2/trail/flatten |
| P5 | 0.76 | null | 60 | 0.09 | undefined | false | No (0.09<0.10) | — |
| P6 | 0.75 | null | 60 | 0.10 | undefined | false | **Yes** (no velocity → allow collapse) | — |

---

## Part 3: Profit lock exit paths (entry 0.85, sell prices)

**Cost:** 10 × 0.85 = $8.50.

### Case 1: Collapse only (velocity adverse)

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | Collapse (mid≤0.75, v adverse) | 0.75 | 10 | 7.50 | −1.00 |

### Case 2: Collapse skipped (velocity favorable), then flatten

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | No collapse (v favorable, mid=0.74) | — | — | — | — |
| 2 | Flatten @ 4.5m | 0.76 | 10 | 7.60 | −0.90 |

### Case 3: Flatten only (no T1/T2/trail/collapse)

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | Flatten @ 4.5m | 0.52 | 10 | 5.20 | −3.30 |

### Case 4: Trail only (HWM=0.87, D=0.0625 → trail 0.8075)

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | Trail | 0.80 | 10 | 8.00 | −0.50 |

### Case 5: T1 → Flatten

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | Flatten | 0.54 | 7 | 3.78 | −0.07 |
|  | **Total** |  |  | **6.42** | **+0.02** |

### Case 6: T1 → Trail

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | Trail (HWM 0.90) | 0.84 | 7 | 5.88 | −0.07 |
|  | **Total** |  |  | **8.52** | **+0.02** |

### Case 7: T1 → T2 → Flatten

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | T2 | 0.925 | 5 | 4.625 | +0.375 |
| 3 | Flatten | 0.56 | 2 | 1.12 | +0.02 |
|  | **Total** |  |  | **8.385** | **+0.485** |

### Case 8: T1 → T2 → Trail

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | T2 | 0.925 | 5 | 4.625 | +0.375 |
| 3 | Trail (HWM 0.94) | 0.88 | 2 | 1.76 | +0.06 |
|  | **Total** |  |  | **9.025** | **+0.525** |

### Case 9: T1 → Collapse (velocity turns adverse)

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | Collapse (mid≤0.75, v adverse) | 0.74 | 7 | 5.18 | −0.77 |
|  | **Total** |  |  | **7.82** | **−0.68** |

### Case 10: T1 → T2 → Collapse

| Step | Event | Price | Shares | Revenue | Step P&L |
|------|--------|-------|--------|---------|----------|
| 0 | Buy | 0.85 | 10 | — | — |
| 1 | T1 | 0.88 | 3 | 2.64 | +0.09 |
| 2 | T2 | 0.925 | 5 | 4.625 | +0.375 |
| 3 | Collapse | 0.73 | 2 | 1.46 | −0.24 |
|  | **Total** |  |  | **8.725** | **+0.225** |

---

## Part 4: Tightened mode (tightenProfitLock = true)

- **Flatten** at **3.15 min** (instead of 4.5).
- **Trail D** = **0.09375** (trail triggers sooner).

Same exit paths as above; only the **time** of flatten and the **trail level** (HWM − 0.09375) change. Example: Trail only with HWM=0.87 → trail level = 0.77625; sell all when mid ≤ 0.77625.

---

## Summary: all exit paths (entry 0.85)

| Case | 1st sell | 2nd sell | 3rd sell |
|------|----------|----------|----------|
| Collapse only (v adverse) | All @ ~0.75 | — | — |
| No collapse (v favorable) → Flatten | All @ market @ 4.5m | — | — |
| Flatten only | All @ market @ 4.5m | — | — |
| Trail only | All @ ~(HWM−0.0625) | — | — |
| T1 → Flatten | 30% @ ~0.88 | 70% @ market @ 4.5m | — |
| T1 → Trail | 30% @ ~0.88 | 70% @ ~trail level | — |
| T1 → T2 → Flatten | 30% @ ~0.88 | 50% @ ~0.925 | 20% @ market @ 4.5m |
| T1 → T2 → Trail | 30% @ ~0.88 | 50% @ ~0.925 | 20% @ ~trail level |
| T1 → Collapse | 30% @ ~0.88 | 70% @ ~0.75 | — |
| T1 → T2 → Collapse | 30% @ ~0.88 | 50% @ ~0.925 | 20% @ ~0.75 |

**Collapse:** Only runs when **velocity is adverse** (or velocity unknown). When velocity is favorable and mid ≤ 0.75, we do **not** collapse; we hold until flatten or trail.
