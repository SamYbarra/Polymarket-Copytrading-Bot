# Profit Lock Engine — Design Specification

**Quantitative trading risk architecture for short-horizon (5-minute) BTC prediction market bot on Polymarket.**

This is **not** a simple take-profit system. It optimizes long-term expected value (EV), Sharpe ratio, equity curve smoothness, survival under volatility, anti-whipsaw, and preservation of upside convexity.

---

## Strategy Context (Anchor)

| Parameter | Value |
|-----------|--------|
| Entry window | Minute 2–3 (config: `PREDICTION_MIN_ELAPSED_SECONDS` ~150, `PREDICTION_TIME_MIN`/`MAX` 2–4) |
| Typical hold | 30–120 seconds |
| Edge | **Edge = Model Probability − Market Probability** (confidence − outcome price) |
| Sizing | Fractional Kelly (config: `BUY_SHARES`, `ML_BUY_AMOUNT_USD`) |
| Market | Single 5-minute BTC Up/Down per window |

---

## 1. Layered Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PROFIT LOCK ENGINE (Orchestrator)                      │
│  Inputs: position, entryPrice, confidence, vol regime, book, time, P(cont.)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
┌───────────────┐           ┌─────────────────┐           ┌─────────────────┐
│ LAYER 1       │           │ LAYER 2         │           │ LAYER 3         │
│ Partial Exit  │           │ Vol-Adaptive    │           │ Bayesian Update  │
│ (Tactical /   │           │ Target Framework│           │ (after T1 hit)   │
│  Core / Vol-  │           │ Low/Norm/High   │           │ P(cont), trail,  │
│  adjusted)    │           │ vol logic       │           │ hold time        │
└───────┬───────┘           └────────┬────────┘           └────────┬────────┘
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: Dynamic Trailing Stop (vol-scaled, momentum-confirmed, liq-aware)   │
│ LAYER 5: Time-Decay Exit (profit decay curve, max hold, EV decay post-min 4) │
│ LAYER 6: Liquidity-Aware Lock (spread, depth, collapse triggers)            │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
┌───────────────┐           ┌─────────────────┐           ┌─────────────────┐
│ LAYER 7       │           │ LAYER 8         │           │ LAYER 9         │
│ Re-Entry      │           │ Over-Locking    │           │ Monte Carlo     │
│ (reduced size,│           │ Detection       │           │ Robustness      │
│  posterior)   │           │ (metrics)       │           │ (backtest)      │
└───────────────┘           └─────────────────┘           └─────────────────┘
```

**Data flow:** Each cycle, the engine receives position state, live price, order book, volatility regime, and time-in-window. It evaluates layers in order; the **first** layer that fires an exit (full or partial) executes; re-entry and over-locking operate asynchronously / in review.

---

## 2. Multi-Level Partial Exit Logic

### 2.1 Definitions

- **Tactical portion**: Lock a quick profit to reduce variance and secure a minimum win. Typically 25–35% of position.
- **Core portion**: Let run with a trailing stop to capture trend; 50–60%.
- **Volatility-adjusted slice**: Optional 10–15% at extended targets in low-vol regimes only.

### 2.2 Mathematical Formulation

Let:
- \( P_0 \) = entry price (best ask at buy),
- \( P \) = current mid (or execution proxy),
- \( \theta \) = predicted outcome (Up/Down); for Up, profit per share = \( (1 - P_0) \) at resolution if win, and price move “in our favor” is \( P - P_0 \).
- **Implied payoff if hold to resolution (win):** \( 1 - P_0 \) per share. So “target in price space” for a 20% profit lock: \( P_{\mathrm{t1}} = P_0 + 0.20(1 - P_0) \) for Up (and analogously for Down).

**Tier 1 (Tactical) — First partial exit**

\[
P_{\mathrm{t1}} = P_0 + \alpha_1\,(1 - P_0), \quad \alpha_1 \in [0.15, 0.25]
\]

Sell **tactical share ratio** \( r_1 \in [0.25, 0.35] \).

**Tier 2 (Core) — Second partial / runner**

\[
P_{\mathrm{t2}} = P_0 + \alpha_2\,(1 - P_0), \quad \alpha_2 \in [0.40, 0.55]
\]

Sell **core share ratio** \( r_2 \in [0.45, 0.55] \) of **remaining** (or of initial: \( r_2^{\mathrm{init}} \approx 0.50 \)).

**Tier 3 (Vol-adjusted) — Optional**

\[
P_{\mathrm{t3}} = P_0 + \alpha_3\,(1 - P_0), \quad \alpha_3 \in [0.70, 0.85], \quad \text{only if } \sigma_{\mathrm{regime}} = \mathrm{Low}
\]

Sell remaining or a small vol-adjusted slice (e.g. 10–15%).

### 2.3 Optimal Scaling Ratios (Guidance)

| Portion   | Share of position | \(\alpha\) (fraction of max payoff) | Purpose |
|-----------|-------------------|--------------------------------------|---------|
| Tactical  | 25–35%            | 15–25%                               | Lock minimum win, reduce variance |
| Core      | 50–60%            | 40–55%                               | Capture trend, trailing on remainder |
| Vol-adj   | 10–15%            | 70–85% (low vol only)                | Convexity in calm regimes |

**Example (Up, \(P_0 = 0.42\)):**

- Max payoff per share if win: \( 1 - 0.42 = 0.58 \).
- T1 at 20%: \( P_{\mathrm{t1}} = 0.42 + 0.20 \times 0.58 = 0.536 \). Sell 30%.
- T2 at 50%: \( P_{\mathrm{t2}} = 0.42 + 0.50 \times 0.58 = 0.71 \). Sell 50% of initial (or 50% of remaining).
- T3 (low vol): \( P_{\mathrm{t3}} = 0.42 + 0.75 \times 0.58 = 0.855 \). Sell remaining 20%.

### 2.4 EV Comparison: Full Hold vs Hybrid Exit

- **Full hold:** EV = \( p_{\mathrm{win}} \cdot (1 - P_0) \cdot Q - (1 - p_{\mathrm{win}}) \cdot P_0 \cdot Q \), with \( p_{\mathrm{win}} \) = model probability (confidence).
- **Hybrid:** EV = \( r_1 Q \cdot (P_{\mathrm{t1}} - P_0) + r_2 Q \cdot \mathbb{E}[(P_{\mathrm{t2}} \wedge \mathrm{exit}) - P_0] + (1 - r_1 - r_2) Q \cdot \mathbb{E}[\text{trail/resolution}] \). With positive edge and sensible \( \alpha_1, \alpha_2 \), partial locking raises floor (reduces variance) and can **improve risk-adjusted return** even if raw EV is slightly lower, because it avoids full exposure to late reversal (minute 4–5).

**Rule of thumb:** Use hybrid when estimated probability of reaching T1 before a material adverse move is high (e.g. > 0.5); otherwise full hold can dominate if edge is very high and vol low.

---

## 3. Volatility-Adaptive Target Framework

### 3.1 Volatility Regime

\[
\mathrm{VolRegime} = \frac{\sigma_{\mathrm{short}}}{\sigma_{\mathrm{long}}}
\]

- \( \sigma_{\mathrm{short}} \): rolling std of 5m outcome returns (or BTC 1m returns) over last 2–3 windows.
- \( \sigma_{\mathrm{long}} \): over last 20–30 windows (or 100–150 minutes).

**Regime bands (tunable):**

| Regime  | Condition              | Interpretation |
|---------|------------------------|----------------|
| Low     | \( \mathrm{VolRegime} < 0.7 \)  | Recent vol below long-run; calm |
| Normal  | \( 0.7 \le \mathrm{VolRegime} \le 1.2 \) | Typical |
| High    | \( \mathrm{VolRegime} > 1.2 \)  | Recent vol elevated; widen targets/stops |

### 3.2 Target Adjustment by Regime

- **Low vol:** Use base \( \alpha_1, \alpha_2, \alpha_3 \); enable T3; tighter trailing (see Layer 4).
- **Normal:** Use base \( \alpha_1, \alpha_2 \); no T3 or small; standard trailing.
- **High vol:**  
  - **Widen** target fractions: \( \alpha_1^{\mathrm{high}} = \alpha_1 + 0.05 \), \( \alpha_2^{\mathrm{high}} = \alpha_2 + 0.10 \).  
  - **Widen** trailing distance (Layer 4).  
  - Disable or relax T3.  
  - **Why fixed targets destroy EV in high vol:** Price oscillates; a fixed tight target gets hit on noise then price continues in our favor—we locked too early. Conversely, a fixed tight stop gets hit by noise and we exit a winner. Adaptive widening in high vol reduces whipsaw and preserves EV.

### 3.3 Parameter Ranges (5-Minute BTC)

| Parameter        | Low Vol   | Normal    | High Vol  |
|-----------------|-----------|-----------|-----------|
| \( \alpha_1 \)  | 0.15–0.20 | 0.20–0.25 | 0.25–0.30 |
| \( \alpha_2 \)  | 0.40–0.50 | 0.50–0.55 | 0.55–0.65 |
| T3 enabled      | Yes       | Optional  | No        |
| Trail mult      | 0.8–1.0   | 1.0       | 1.2–1.5   |

---

## 4. Bayesian Probability Update (After First Target Hit)

### 4.1 Idea

Once T1 is hit, we have a **signal**: price moved in our favor. Update the continuation probability (probability we keep moving toward resolution in our favor) and use it to adjust trailing distance and hold time.

### 4.2 Simplified Bayesian Formula

Let:
- \( P(\mathrm{cont}) \) = probability of favorable continuation (e.g. price reaches T2 or resolution in our favor).
- Prior: \( P(\mathrm{cont})_{\mathrm{prior}} \propto \mathrm{confidence} \) (model edge).
- Likelihood: Having reached T1 quickly (e.g. within 30–60s) is more likely if the move is real than if it’s noise.

\[
P(\mathrm{cont} \mid \mathrm{T1\,hit}) = \frac{ P(\mathrm{T1\,hit} \mid \mathrm{cont}) \, P(\mathrm{cont})_{\mathrm{prior}} }{ P(\mathrm{T1\,hit}) }
\]

**Practical implementation:**

- \( P(\mathrm{T1\,hit} \mid \mathrm{cont}) \): from backtest or heuristic (e.g. 0.7–0.85 when trend is real).
- \( P(\mathrm{T1\,hit}) \): from historical hit rate of T1 (e.g. 0.4–0.5).
- Then \( P(\mathrm{cont})_{\mathrm{post}} \) increases (e.g. from 0.6 to 0.75). Use this to **tighten** trailing (we’re more confident) and extend **max hold** slightly for the core portion.

### 4.3 Implementation Logic

```text
ON_T1_HIT:
  prior_cont = confidence   // e.g. 0.72
  likelihood_real = 0.75     // from calibration
  likelihood_noise = 0.25
  P_T1 = prior_cont * likelihood_real + (1 - prior_cont) * likelihood_noise
  posterior_cont = (likelihood_real * prior_cont) / P_T1

  trailing_distance_mult = 1.0 - 0.2 * (posterior_cont - 0.5)   // tighten if high
  max_hold_extension_sec = 15 * (posterior_cont - 0.5)         // e.g. +7.5s if 0.75
```

**Example:** confidence = 0.72, T1 hit. \( P(\mathrm{cont})_{\mathrm{post}} \approx 0.78 \). Then trailing distance multiplier = 0.94; extend max hold by ~4 s. Reduces chance of trailing out on noise while keeping protection.

---

## 5. Dynamic Trailing Stop Layer

### 5.1 Volatility-Scaled Trailing Distance

**Reference distance (in price):**

\[
D_{\mathrm{base}} = k_{\mathrm{trail}} \cdot \sigma_{\mathrm{short}} \cdot \sqrt{\tau},\quad \tau = \text{time to resolution (minutes)}
\]

For 5m markets, \( \tau \in [1, 3] \) when we’re in the exit window. Alternatively use a fixed **price distance**:

\[
D_{\mathrm{trail}} = \max\bigl( D_{\mathrm{min}},\; \min( D_{\mathrm{max}},\; D_{\mathrm{base}} \cdot \mathrm{VolRegimeMult} \cdot \mathrm{EdgeMult} ) \bigr)
\]

- \( D_{\mathrm{min}} \): e.g. 0.02–0.03 (avoid microstructure).
- \( D_{\mathrm{max}} \): e.g. 0.08–0.12 (avoid giving back everything).
- **VolRegimeMult:** 0.8 (low), 1.0 (normal), 1.2–1.5 (high).
- **EdgeMult:** \( 1.0 - 0.15 \cdot (\mathrm{confidence} - 0.5) \); higher edge → slightly tighter trail (we trust the move).

### 5.2 Momentum-Confirmed Tightening

If price has moved in our favor for two consecutive ticks (or two 5–10s buckets), reduce \( D_{\mathrm{trail}} \) by 10–15% so we lock more of the move. If price reverses once, revert to normal \( D_{\mathrm{trail}} \).

### 5.3 Liquidity-Aware Widening

If spread > threshold (e.g. 3–5% of mid) or depth on our side < 2× position size, multiply \( D_{\mathrm{trail}} \) by 1.2–1.3 to avoid getting stopped by thin-book spikes.

### 5.4 Anti-Whipsaw Logic

- **Cooldown:** After moving trail “up” (in our favor), do not move it “down” for at least \( t_{\mathrm{cooldown}} \) (e.g. 15–20 s) unless price drops more than \( 1.5 \times D_{\mathrm{trail}} \).
- **Minimum move:** Trail only updates when price improves by at least \( 0.5 \times D_{\mathrm{trail}} \) (avoids tick-by-tick noise).

### 5.5 Edge-Adjusted Trailing Distance (Formula)

\[
D_{\mathrm{trail}}^{\mathrm{final}} = D_{\mathrm{trail}} \cdot \bigl( 1 - \beta \, (\mathrm{confidence} - 0.5) \bigr),\quad \beta \in [0.10, 0.20]
\]

Higher confidence → slightly tighter trail to capture more of the expected move.

---

## 6. Time-Decay Exit Layer

### 6.1 Profit Decay Curve

EV of holding decays as we approach resolution because:
- Less time for price to move further in our favor.
- More weight on resolution outcome; binary payoff dominates.

**Heuristic:** After minute 4 (e.g. 240 s), treat “expected additional price appreciation” as decaying:

\[
\lambda(t) = \exp\bigl( -\gamma \, (t - t_0) / T \bigr),\quad t_0 = 240\,\mathrm{s},\; T = 60\,\mathrm{s},\; \gamma \in [1.5, 2.5]
\]

So from 4m to 5m, we gradually de-risk: tighten trail, reduce “runner” size, or set a hard “flatten by 4:30” rule.

### 6.2 Maximum Optimal Hold Time

Given entry at 2–3 min, **max optimal hold** for the core portion is typically 90–120 s from entry, or “until 30–60 s before resolution” (e.g. 4:00–4:30). Beyond that, EV of waiting for more price move is low; resolution risk dominates.

### 6.3 Gradual De-Risking Logic

- **At 3:30:** If no T1 hit, consider lowering T1 threshold by 2–3% or leaving as is.
- **At 4:00:** If T1 hit but not T2, tighten trailing by 10%; if neither hit, consider market-order exit at mid if edge is still positive.
- **At 4:30:** Prefer to flatten remaining position (market sell) unless spread is extreme, to avoid resolution binary risk.

---

## 7. Liquidity-Aware Profit Lock

### 7.1 Order Book Thinning

- **Spread-based:** If spread > 5% of mid, do not place limit exit at aggressive level; use market or widen limit. Adjust target: \( P_{\mathrm{t1}}^{\mathrm{adj}} = P_{\mathrm{t1}} - 0.5 \times \mathrm{spread} \) so we don’t chase.
- **Depth-based:** If available depth (bid or ask, depending on side) < 1.5× our exit size, split exit into 2–3 chunks or use time-weighted execution.

### 7.2 Sudden Probability Collapse

If mid moves against us by more than \( \theta_{\mathrm{collapse}} \) (e.g. 8–12%) within one cycle (e.g. 10–20 s), treat as possible collapse: **exit priority = 1** (market exit a portion immediately, e.g. 50%, then reassess).

### 7.3 Exit Priority Ranking

1. **Collapse trigger** (large adverse move) → immediate partial market exit.
2. **T1 / T2 / T3** (limit orders or triggered limits).
3. **Trailing stop** (stop order or synthetic).
4. **Time-decay exit** (at 4:30).
5. **Resolution hold** (hold to resolution only if no other exit and size is small).

### 7.4 Slippage

Assume 0.5–1% slippage on market exit when sizing; reduce position size in EV calc for partial exits by (1 - slippage) for that portion.

---

## 8. Re-Entry Logic After Profit Lock

### 8.1 Conditions

- We locked profit (e.g. T1 or partial trail).
- Price **retraces** back toward entry but:
  - **Momentum still valid:** e.g. still above entry, or 1m momentum (price change) still in our direction.
  - **Model probability still high:** confidence from same model (or refreshed) still above re-entry threshold (e.g. 0.65).

### 8.2 Reduced Size Re-Entry

Re-enter with **half** (or 1/3) of original size to avoid revenge trading and over-exposure. \( Q_{\mathrm{reentry}} = \min( Q_{\mathrm{orig}} \cdot 0.5,\; Q_{\mathrm{max\_reentry}} ) \).

### 8.3 Posterior Probability Adjustment

Use **posterior** from Bayesian update (e.g. after T1) as new prior for re-entry: only re-enter if \( P(\mathrm{cont})_{\mathrm{post}} > 0.6 \) and confidence (current) > 0.65.

### 8.4 Avoid Revenge Trading

- **Cooldown:** No re-entry within 30–60 s of exit.
- **Cap:** At most one re-entry per market per window.
- **Hard rule:** If we exited on collapse trigger, **no** re-entry in that market.

---

## 9. Over-Locking Detection

### 9.1 Stop Efficiency Score (SES)

\[
\mathrm{SES} = \frac{ \text{Realized P&amp;L from stops (trail + partial)} }{ \text{Theoretical P&amp;L if we had held same portion to resolution} }
\]

- SES &lt; 0.5 suggests we’re exiting too early (stops/targets too tight).  
- SES &gt; 1.0 would mean we’re capturing more than hold (possible if we re-enter; otherwise check for bug).

### 9.2 Expected Move Capture %

\[
\mathrm{EMC} = \frac{ \text{Average realized profit per winning trade} }{ \text{Average max favorable excursion (MFE) in same trades} }
\]

- EMC &lt; 0.5: we’re leaving a lot on the table (over-locking).  
- Target: EMC in [0.55, 0.75] for a balanced system.

### 9.3 Profit Lock Sharpness Ratio (PLSR)

\[
\mathrm{PLSR} = \frac{ \text{Std dev of trade P&amp;L} }{ \text{Mean trade P&amp;L} }
\]

- **Decreasing** PLSR as we add profit lock (smoother equity) is good.  
- **Increasing** PLSR with lock suggests we’re cutting winners too much and letting losers run, or whipsawing.

### 9.4 Usage

- Run these metrics in backtest and live (rolling window).  
- If SES drops or EMC drops below 0.5, **widen** targets or **loosen** trailing.  
- If upside convexity (right tail of P&amp;L) shrinks vs full hold, reduce \( r_1 \) or \( \alpha_1 \).

---

## 10. Monte Carlo Robustness Test

### 10.1 Framework

- **Inputs:** Entry price distribution, confidence distribution, volatility regime distribution, and a simple price path model (e.g. binomial or small number of paths from historical 5m returns).
- **Parameters to vary:** \( \alpha_1, \alpha_2, r_1, r_2 \), trailing \( D_{\mathrm{min}}, D_{\mathrm{max}} \), VolRegime thresholds.
- **Outputs:** Distribution of P&amp;L per trade, max drawdown, Sharpe, SES, EMC, PLSR.

### 10.2 Tests

1. **Parameter sensitivity:** Vary each parameter ±20%; require that Sharpe and EV don’t drop more than 10%.
2. **Regime robustness:** Run under “all low vol”, “all high vol”, “mixed”; profit lock should improve or not harm Sharpe in each.
3. **Worst-case variance:** Inject 2× vol shocks in 10% of paths; drawdown should stay below 2× baseline drawdown.
4. **Calibration:** Choose parameter set that maximizes Sharpe subject to EMC ≥ 0.55 and SES ≥ 0.5.

### 10.3 Pseudo-Code (High Level)

```text
FOR each parameter set in grid:
  FOR i = 1 to N_sim (e.g. 5000):
    path = simulate_path(vol_regime, confidence, entry_price)
    pnl_i = run_profit_lock_engine(path, parameter_set)
  END
  compute sharpe(pnl), dd(pnl), SES, EMC, PLSR
  IF sharpe acceptable AND EMC >= 0.55 AND SES >= 0.5: keep set
END
RETURN best parameter set
```

---

## 11. Parameter Ranges Summary (5-Minute BTC)

| Symbol / Name       | Suggested range      | Notes |
|---------------------|----------------------|--------|
| \( \alpha_1 \)      | 0.15–0.25           | First target (% of max payoff) |
| \( \alpha_2 \)      | 0.40–0.55           | Second target |
| \( \alpha_3 \)      | 0.70–0.85           | Third (low vol only) |
| \( r_1 \)           | 0.25–0.35           | Tactical share ratio |
| \( r_2 \)           | 0.45–0.55           | Core share ratio |
| \( D_{\mathrm{min}} \) | 0.02–0.03        | Min trail (price) |
| \( D_{\mathrm{max}} \) | 0.08–0.12        | Max trail (price) |
| VolRegime low       | &lt; 0.7            | Short/long vol ratio |
| VolRegime high      | &gt; 1.2            | |
| \( t_{\mathrm{cooldown}} \) | 15–20 s        | Anti-whipsaw |
| Max hold (from entry) | 90–120 s          | Core portion |
| De-risk start       | 4:00–4:30          | Time in window |
| Re-entry size       | 0.33–0.50 of orig  | |
| Re-entry cooldown   | 30–60 s            | |

---

## 12. Example Trade Walkthrough

1. **Entry:** Minute 2:30, Up, \( P_0 = 0.42 \), confidence = 0.72, vol regime = Normal.
2. **T1:** \( P_{\mathrm{t1}} = 0.42 + 0.20 \times 0.58 = 0.536 \). At 2:45 price hits 0.54 → sell 30% (tactical). Bayesian update: \( P(\mathrm{cont})_{\mathrm{post}} \approx 0.78 \); tighten trail slightly, extend hold.
3. **Trail:** Base \( D_{\mathrm{trail}} = 0.04 \), edge mult 0.97 → 0.039. Trail at 0.54 - 0.039 = 0.501.
4. **T2:** \( P_{\mathrm{t2}} = 0.71 \). At 3:00 price 0.72 → sell 50% of initial (core). Remainder 20%.
5. **Time decay:** At 4:00 trail tightened by 10%. At 4:25 remainder 20% sold at mid 0.68 (flatten).
6. **Result:** 30% @ ~0.54, 50% @ 0.72, 20% @ 0.68 vs entry 0.42. No whipsaw; convexity partially captured.

---

## 13. Failure Cases and Mitigation

| Failure | Mitigation |
|--------|------------|
| T1 never hit, then reversal | Time-decay exit and trailing limit loss; avoid “hold to resolution” for full size. |
| Whipsaw on trail | Cooldown + min move + vol-scaled \( D_{\mathrm{trail}} \); avoid tightening too fast. |
| Over-lock (low EMC) | Widen \( \alpha_1, \alpha_2 \); reduce \( r_1 \); monitor SES/EMC. |
| Thin book slippage | Depth-based exit; widen trail; smaller chunks. |
| Collapse after T1 | Bayesian update already reduced size; re-entry disabled on collapse. |
| Regime misclassification | Use 3-state with hysteresis; don’t flip regime on one bar. |

---

## 14. Trade-Offs Discussion

- **Partial exit vs full hold:** Partial raises floor and smooths curve but caps upside; optimal for risk-adjusted (Sharpe) and survival.
- **Tight vs loose trail:** Tight → more lock, more whipsaw; loose → more convexity, more give-back. Vol- and edge-adjustment balance this.
- **Re-entry:** Adds upside but adds complexity and revenge risk; keep size and frequency capped.
- **Time-decay:** Earlier flatten reduces binary resolution risk but may leave money on table if move is late; use gradual de-risk rather than hard cut.

---

## 15. How Hedge Funds Design Profit Lock Without Destroying Upside Convexity

1. **Scale out, don’t stop out winners:** Lock a **portion** at targets (tactical/core) and let a **runner** with a trailing stop. The runner preserves convexity.
2. **Volatility- and regime-adapt:** No single set of targets/stops for all environments; widen in high vol, tighten in low vol.
3. **Update beliefs with data:** After a target hit, use Bayesian (or similar) to tighten trail and extend hold on the remainder instead of freezing rules.
4. **Protect the right tail:** Over-locking metrics (EMC, SES) are monitored; if realized capture of “max favorable excursion” falls, parameters are relaxed.
5. **Liquidity and execution:** Stops and targets are adjusted for spread and depth; avoid mechanical stops in illiquid regimes that get run.
6. **Time horizon alignment:** For 5m markets, “max optimal hold” and time-decay are explicit so the system doesn’t pretend it’s a long-horizon strategy.
7. **Robustness over fit:** Monte Carlo and regime tests ensure the system doesn’t overfit to one vol regime; acceptable performance in worst-case variance is a constraint.
8. **Re-entry as optional convexity:** Small, rule-based re-entry (size and cooldown limited) can add back some convexity after a lock without turning into revenge trading.

Together, this keeps **expected value** and **right tail** (convexity) while improving **Sharpe** and **survival** through partial locks, adaptive targets, and disciplined trailing and time-decay.

---

## Implementation Notes (Codebase Hooks)

**Integration status: NOT integrated.** The engine is specified and typed but not wired into the trading loop. To integrate: (1) Ensure a trading monitor exists that runs the predict/buy cycle. (2) After each buy, create and store `ProfitLockPositionState` per conditionId. (3) Each cycle, for open positions, get book + vol regime and run the profit-lock evaluator; if action ≠ hold, execute sell and update state. (4) Implement a sell path (CLOB sell + holdings update). (5) Supply volatility (σ_short, σ_long) for VolRegime.

- **Types and defaults:** `src/services/profit-lock/types.ts` defines `ProfitLockParams`, `ProfitLockPositionState`, `ProfitLockAction`, `VolRegime`, and `DEFAULT_PROFIT_LOCK_PARAMS` for 5-minute BTC.

- **Entry/position:** `MlBuyDoc` (conditionId, outcomePrice, confidence, boughtAt); `addHoldings(conditionId, tokenId, shares)`.
- **Market timing:** `marketWindowMinutes()`, `getCurrentWindowTs()`, `predictionMinElapsedSeconds()`, `defaultPredictionTimeMaxMinutes()` from `src/config/market.ts`.
- **Live price/book:** `RealtimePriceService.getPrice(tokenId)`, `getOrderBook(tokenId)`.
- **Selling:** CLOB sell (inverse of `buyWinToken`); no sell path exists yet—Profit Lock Engine will need a **sell service** (limit/market) and a **position state** (per conditionId: entry price, shares, T1/T2 hit flags, trail level, last update).
- **Volatility:** Can be computed from Redis/history of 5m outcomes or from BTC 1m returns; feature pipeline or a small `VolatilityService` can expose \( \sigma_{\mathrm{short}}, \sigma_{\mathrm{long}} \).

---

## 16. Pseudo-Code: Per-Cycle Decision Flow

```text
FUNCTION evaluateProfitLock(conditionId, position, marketInfo, book, volRegime):
  entryPrice = position.entryPrice
  confidence = position.confidence
  now = currentTime()
  minutesElapsed = (now - marketInfo.startTime) / 60
  mid = (book.bestBid + book.bestAsk) / 2
  spread = book.bestAsk - book.bestBid

  // Layer 6 (priority): liquidity / collapse
  IF adverseMove(entryPrice, mid) > COLLAPSE_THRESHOLD:
    RETURN action(EXIT_PARTIAL_MARKET, size = 0.5 * position.shares)
  IF spread > SPREAD_MAX AND depth < position.shares * 1.5:
    adjustTargetsForSlippage(spread)

  // Layer 1 + 2: partial targets (vol-adaptive)
  (alpha1, alpha2, alpha3) = getVolAdaptiveAlphas(volRegime)
  P_t1 = entryPrice + alpha1 * (1 - entryPrice)   // Up; for Down mirror
  P_t2 = entryPrice + alpha2 * (1 - entryPrice)
  IF mid >= P_t1 AND NOT position.t1Hit:
    RETURN action(SELL_PARTIAL, ratio = r1, level = P_t1); SET position.t1Hit
  IF mid >= P_t2 AND NOT position.t2Hit:
    RETURN action(SELL_PARTIAL, ratio = r2, level = P_t2); SET position.t2Hit
  IF volRegime == LOW AND mid >= P_t3:
    RETURN action(SELL_REMAINING)

  // Layer 4: trailing (only after T1 or after N seconds in profit)
  IF position.t1Hit OR (mid > entryPrice AND holdSeconds > 30):
    D = computeTrailDistance(volRegime, confidence, spread, depth)
    trailLevel = position.highWaterMark - D
    IF mid <= trailLevel:
      RETURN action(SELL_TRAIL, level = trailLevel)
    IF mid > position.highWaterMark:
      position.highWaterMark = mid
      UPDATE trailLevel with cooldown and min-move rules

  // Layer 5: time decay
  IF minutesElapsed >= 4.5:
    RETURN action(FLATTEN_REMAINING)
  IF minutesElapsed >= 4.0:
    tightenTrail(0.9)

  // Layer 3: Bayesian state (used when updating trail / hold)
  IF position.t1Hit AND NOT position.bayesianUpdated:
    position.posteriorCont = bayesianUpdate(confidence, T1_HIT_LIKELIHOOD)
    position.trailingMult = 1.0 - 0.2 * (position.posteriorCont - 0.5)
    position.bayesianUpdated = true

  RETURN action(HOLD)
END
```

---

This document is the single source of truth for the Profit Lock Engine design; implementation can proceed in layers (partial exit → vol-adaptive → Bayesian → trailing → time-decay → liquidity → re-entry → metrics → Monte Carlo).
