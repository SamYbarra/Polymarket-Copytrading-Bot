# Profit Lock — All Cases with P&L Examples

**Shared setup (every case):**
- Buy **10 shares** at **entry = 0.55** → total cost = **$5.50**
- Config (defaults): `ALPHA1=0.20`, `ALPHA2=0.50`, `R1=0.30`, `R2=0.50`, `COLLAPSE_THRESHOLD=0.10`, `TRAIL_MIN=0.025`, `TRAIL_MAX=0.10`, `FLATTEN_BY_MIN=4.5`
- Target prices: **P1** = 0.55 + 0.20×(1−0.55) = **0.64**, **P2** = 0.55 + 0.50×(1−0.55) = **0.775**
- Trail distance **D** = (TRAIL_MIN + TRAIL_MAX)/2 = **0.0625** → trail level = highWaterMark − 0.0625

**P&L formula (every sale):**  
Profit = (sell price − entry price) × shares sold.  
Total P&L = sum over all sales − total cost (or equivalently: sum of (sell price − entry) × shares for each sale).

---

## Case 1: Collapse only

Price drops immediately; never hits T1/T2/trail; **collapse** fires first (adverse ≥ 0.10).

- **Sell:** all 10 shares at **collapse price = 0.44** (adverse = 0.11).
- Revenue = 10 × 0.44 = **$4.40**
- Cost = **$5.50**
- **Total P&L = 4.40 − 5.50 = −$1.10**

| Step | Event    | Price | Shares | Revenue | Cost (portion) | Step P&L  |
|------|----------|-------|--------|---------|----------------|-----------|
| 0    | Buy      | 0.55  | 10     | —       | 5.50           | —         |
| 1    | Collapse | 0.44  | 10     | 4.40    | 5.50           | **−1.10** |

---

## Case 2: Flatten only

Time runs out; price never hits T1, T2, trail, or collapse. **Flatten** at 4.5 min.

- **Sell:** all 10 shares at **flatten price = 0.52**.
- Revenue = 10 × 0.52 = **$5.20**
- Cost = **$5.50**
- **Total P&L = 5.20 − 5.50 = −$0.30**

| Step | Event   | Price | Shares | Revenue | Cost (portion) | Step P&L  |
|------|---------|-------|--------|---------|----------------|-----------|
| 0    | Buy     | 0.55  | 10     | —       | 5.50           | —         |
| 1    | Flatten | 0.52  | 10     | 5.20    | 5.50           | **−0.30** |

---

## Case 3: Trail only

No T1/T2 hit; price goes up (favorable), hold ≥ 30s, then drops to **trail level**. Trail sells all remaining.

- HighWaterMark = **0.70** → trail level = 0.70 − 0.0625 = **0.6375**. Sell 10 @ **0.63**.
- Revenue = 10 × 0.63 = **$6.30**
- Cost = **$5.50**
- **Total P&L = 6.30 − 5.50 = +$0.80**

| Step | Event | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|-------|-------|--------|---------|----------------|----------|
| 0    | Buy   | 0.55  | 10     | —       | 5.50           | —        |
| 1    | Trail | 0.63  | 10     | 6.30    | 5.50           | **+0.80**|

---

## Case 4: T1 → Flatten

T1 hit (sell 30% of original); rest flattened by time.

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- **Flatten:** sell 7 @ **0.54**. Revenue 3.78, cost 3.85 → −0.07.
- **Total P&L = 0.27 − 0.07 = +$0.20**

| Step | Event   | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|---------|-------|--------|---------|----------------|----------|
| 0    | Buy     | 0.55  | 10     | —       | 5.50           | —        |
| 1    | T1      | 0.64  | 3      | 1.92    | 1.65           | +0.27    |
| 2    | Flatten | 0.54  | 7      | 3.78    | 3.85           | −0.07    |
|      | **Total** |       |       | **5.70** | **5.50**     | **+0.20**|

---

## Case 5: T1 → Trail

T1 hit; then price pulls back to trail (no T2).

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- HighWaterMark after T1 = **0.72** (price went up then dropped). Trail level = 0.72 − 0.0625 = **0.6575**. **Trail:** sell 7 @ **0.65**. Revenue 4.55, cost 3.85 → +0.70.
- **Total P&L = 0.27 + 0.70 = +$0.97**

| Step | Event | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|-------|-------|--------|---------|----------------|----------|
| 0    | Buy   | 0.55  | 10     | —       | 5.50           | —        |
| 1    | T1    | 0.64  | 3      | 1.92    | 1.65           | +0.27    |
| 2    | Trail | 0.65  | 7      | 4.55    | 3.85           | +0.70    |
|      | **Total** |     |       | **6.47** | **5.50**     | **+0.97**|

---

## Case 6: T1 → T2 → Flatten

T1, then T2, then time flattens the remainder.

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- **T2:** sell 5 @ **0.78**. Revenue 3.90, cost 2.75 → +1.15.
- **Flatten:** sell 2 @ **0.56**. Revenue 1.12, cost 1.10 → +0.02.
- **Total P&L = 0.27 + 1.15 + 0.02 = +$1.44**

| Step | Event   | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|---------|-------|--------|---------|----------------|----------|
| 0    | Buy     | 0.55  | 10     | —       | 5.50           | —        |
| 1    | T1      | 0.64  | 3      | 1.92    | 1.65           | +0.27    |
| 2    | T2      | 0.78  | 5      | 3.90    | 2.75           | +1.15    |
| 3    | Flatten | 0.56  | 2      | 1.12    | 1.10           | +0.02    |
|      | **Total** |       |       | **6.94** | **5.50**     | **+1.44**|

---

## Case 7: T1 → T2 → Trail

T1, then T2; remainder sold at trail.

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- **T2:** sell 5 @ **0.78**. Revenue 3.90, cost 2.75 → +1.15.
- HighWaterMark = **0.80**. Trail level = 0.80 − 0.0625 = **0.7375**. **Trail:** sell 2 @ **0.73**. Revenue 1.46, cost 1.10 → +0.36.
- **Total P&L = 0.27 + 1.15 + 0.36 = +$1.78**

| Step | Event | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|-------|-------|--------|---------|----------------|----------|
| 0    | Buy   | 0.55  | 10     | —       | 5.50           | —        |
| 1    | T1    | 0.64  | 3      | 1.92    | 1.65           | +0.27    |
| 2    | T2    | 0.78  | 5      | 3.90    | 2.75           | +1.15    |
| 3    | Trail | 0.73  | 2      | 1.46    | 1.10           | +0.36    |
|      | **Total** |     |       | **7.28** | **5.50**     | **+1.78**|

---

## Case 8: T1 → Collapse

T1 hit; then price dumps and **collapse** fires (sell all remaining).

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- **Collapse:** sell 7 @ **0.43** (adverse = 0.12). Revenue 3.01, cost 3.85 → −0.84.
- **Total P&L = 0.27 − 0.84 = −$0.57**

| Step | Event   | Price | Shares | Revenue | Cost (portion) | Step P&L  |
|------|---------|-------|--------|---------|----------------|-----------|
| 0    | Buy     | 0.55  | 10     | —       | 5.50           | —         |
| 1    | T1      | 0.64  | 3      | 1.92    | 1.65           | +0.27     |
| 2    | Collapse| 0.43  | 7      | 3.01    | 3.85           | −0.84     |
|      | **Total** |       |       | **4.93** | **5.50**     | **−0.57** |

---

## Case 9: T1 → T2 → Collapse

T1 and T2 hit; then price dumps and **collapse** sells the remainder.

- **T1:** sell 3 @ **0.64**. Revenue 1.92, cost 1.65 → +0.27.
- **T2:** sell 5 @ **0.78**. Revenue 3.90, cost 2.75 → +1.15.
- **Collapse:** sell 2 @ **0.42** (adverse ≥ 0.10). Revenue 0.84, cost 1.10 → −0.26.
- **Total P&L = 0.27 + 1.15 − 0.26 = +$1.16**

| Step | Event   | Price | Shares | Revenue | Cost (portion) | Step P&L |
|------|---------|-------|--------|---------|----------------|----------|
| 0    | Buy     | 0.55  | 10     | —       | 5.50           | —        |
| 1    | T1      | 0.64  | 3      | 1.92    | 1.65           | +0.27    |
| 2    | T2      | 0.78  | 5      | 3.90    | 2.75           | +1.15    |
| 3    | Collapse| 0.42  | 2      | 0.84    | 1.10           | −0.26    |
|      | **Total** |       |       | **6.66** | **5.50**     | **+1.16**|

---

## Summary table (all 9 cases)

| # | Case              | Exit path           | Total revenue | Total cost | **P&L**   |
|---|-------------------|---------------------|---------------|------------|-----------|
| 1 | Collapse only     | collapse            | 4.40          | 5.50       | **−1.10** |
| 2 | Flatten only      | flatten             | 5.20          | 5.50       | **−0.30** |
| 3 | Trail only        | trail               | 6.30          | 5.50       | **+0.80** |
| 4 | T1 → Flatten      | T1, flatten         | 5.70          | 5.50       | **+0.20** |
| 5 | T1 → Trail        | T1, trail           | 6.47          | 5.50       | **+0.97** |
| 6 | T1 → T2 → Flatten | T1, T2, flatten     | 6.94          | 5.50       | **+1.44** |
| 7 | T1 → T2 → Trail   | T1, T2, trail       | 7.28          | 5.50       | **+1.78** |
| 8 | T1 → Collapse     | T1, collapse        | 4.93          | 5.50       | **−0.57** |
| 9 | T1 → T2 → Collapse| T1, T2, collapse    | 6.66          | 5.50       | **+1.16** |

**Notes:**
- **Collapse** and **trail** and **flatten** in code sell **all remaining** shares (not partial); only **T1** and **T2** sell a fraction of **original** shares (R1=30%, R2=50%).
- Evaluation order: collapse → T1 → T2 → trail → flatten. First match wins each loop.
- **Velocity tightening** only shortens flatten time and widens trail distance; the same 9 cases apply, with different timing/levels.
