# Profit Lock at Entry 0.85 — All Cases (Current Config)

**Entry price:** 0.85  
**Config used:** ALPHA1=0.20, ALPHA2=0.50, R1=0.30, R2=0.50, COLLAPSE_THRESHOLD=0.10, TRAIL_MIN=0.025, TRAIL_MAX=0.10, FLATTEN_BY_MIN=4.5. Tightened (when velocity says so): FLATTEN at 3.15 min, trail D = 0.09375.

**Target prices (formula: entry + α×(1−entry)):**
- **P1** = 0.85 + 0.20×0.15 = **0.88**
- **P2** = 0.85 + 0.50×0.15 = **0.925**

**Trail distance D:** normal = (0.025+0.10)/2 = **0.0625**; tightened = **0.09375**.

All sells are **market sells**: we get the **best ask** at the moment the signal fires. The “sell price” below is the **trigger level** (mid) or the level we’re *around* when we sell; actual fill is at best ask (often close to mid).

---

## 1. Collapse only

- **When:** Mid drops so much that **adverse ≥ 0.10** → mid ≤ entry − 0.10 = **0.75**.
- **Sell:** All remaining at **market when mid ≤ 0.75** (so we sell around **0.75 or below**).
- **Price:** You sell when the market is already at ~**0.75** (or worse); fill is at best ask there (e.g. 0.74–0.75).

---

## 2. Flatten only

- **When:** No T1/T2/trail/collapse; **elapsed time** since **market start** ≥ 4.5 min (or ≥ 3.15 min if tightened).
- **Sell:** All remaining at **market at that time**.
- **Price:** Whatever the market is at 4.5 min (or 3.15 min). Could be above or below 0.85 (e.g. **0.82**, **0.90**, etc.).

---

## 3. Trail only

- **When:** No T1/T2 hit; mid has been **≥ entry** and you’ve held **≥ 30 s**; then mid falls to **trail level** = highWaterMark − D.
- **Example:** HighWaterMark = 0.87, D = 0.0625 → trail level = **0.8075**. When mid ≤ 0.8075 we sell.
- **Sell:** All at **market when mid ≤ (highWaterMark − 0.0625)**.
- **Price:** Around **trail level** (e.g. **0.8075** in the example); fill at best ask near that.

---

## 4. T1 → Flatten

- **T1:** When mid first reaches **≥ 0.88**, sell **30%** of original shares at **market** (sell **at ~0.88**).
- **Flatten:** At 4.5 min (or 3.15 if tightened), sell the remaining **70%** at **market** (price = whatever it is then, e.g. **0.84** or **0.86**).

---

## 5. T1 → Trail

- **T1:** Sell 30% at **~0.88** when mid ≥ 0.88.
- **Trail:** highWaterMark might be e.g. 0.90 → trail level = 0.90 − 0.0625 = **0.8375**. Sell remaining 70% when mid ≤ **0.8375** (fill around that price).

---

## 6. T1 → T2 → Flatten

- **T1:** Sell 30% at **~0.88**.
- **T2:** Sell 50% of original at **~0.925** when mid ≥ 0.925.
- **Flatten:** At 4.5 min (or 3.15), sell remaining 20% at **market** (price = whatever at that time, e.g. **0.91**).

---

## 7. T1 → T2 → Trail

- **T1:** Sell 30% at **~0.88**.
- **T2:** Sell 50% at **~0.925**.
- **Trail:** e.g. highWaterMark = 0.94 → trail level = 0.94 − 0.0625 = **0.8775**. Sell remaining 20% when mid ≤ **0.8775** (fill around **0.8775**).

---

## 8. T1 → Collapse

- **T1:** Sell 30% at **~0.88**.
- **Collapse:** Mid later drops to **≤ 0.75**. Sell remaining 70% at **market** (around **0.75** or below).

---

## 9. T1 → T2 → Collapse

- **T1:** Sell 30% at **~0.88**.
- **T2:** Sell 50% at **~0.925**.
- **Collapse:** Mid drops to **≤ 0.75**. Sell remaining 20% at **market** (around **0.75** or below).

---

## Summary: When we sell and at what price (entry 0.85)

| Case              | First sell      | Second sell     | Third sell      |
|-------------------|-----------------|-----------------|-----------------|
| Collapse only     | All @ **~0.75** | —               | —               |
| Flatten only      | All @ **market at 4.5m** | —        | —               |
| Trail only        | All @ **~trail level** (e.g. HWM−0.0625) | — | —     |
| T1 → Flatten      | 30% @ **~0.88** | 70% @ market at 4.5m | — |
| T1 → Trail        | 30% @ **~0.88** | 70% @ **~trail level** | — |
| T1→T2→Flatten     | 30% @ **~0.88** | 50% @ **~0.925** | 20% @ market at 4.5m |
| T1→T2→Trail       | 30% @ **~0.88** | 50% @ **~0.925** | 20% @ **~trail level** |
| T1 → Collapse     | 30% @ **~0.88** | 70% @ **~0.75** | —               |
| T1→T2→Collapse    | 30% @ **~0.88** | 50% @ **~0.925** | 20% @ **~0.75** |

**Fixed trigger levels for entry 0.85:**
- **Collapse:** sell when mid ≤ **0.75** (price around 0.75).
- **T1:** sell 30% when mid ≥ **0.88** (price ~0.88).
- **T2:** sell 50% when mid ≥ **0.925** (price ~0.925).
- **Trail:** sell rest when mid ≤ **highWaterMark − 0.0625** (or −0.09375 if tightened).
- **Flatten:** sell rest when **time ≥ 4.5 min** (or 3.15 min if tightened); price = market then.

All “sell at X” are market orders; you get **best ask** at trigger time, which is typically close to the mid levels above.
