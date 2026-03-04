# Profit Protect System — Issues and Risks (Senior Review)

No code changes; analysis only. Ordered by severity / impact.

---

## 1. Sell price uses best ask instead of best bid (execution risk)

**Where:** `run.ts` line ~163: `const price = priceStream.getBestAsk(tokenId) ?? position.entryPrice` for **market sell**.

**Issue:** For a **sell** order, the executable price is the **best bid** (buyers’ side). Passing **best ask** (sellers’ side) can mean:
- Order sent at a price above where buyers are; fill may be worse or delayed.
- Executor multiplies by 0.98, but that is still anchored to the wrong side of the book.

**Risk:** Worse fills on every sell (T1, T2, trail, collapse, flatten), especially in fast or wide markets. Can turn a “profitable” level (e.g. trail at 0.84) into a worse realized price or partial fill.

**Recommendation (for later):** Use `getBestBid(tokenId)` for sell price (and expose it from the stream if missing).

---

## 2. Limit order at 0.97 and profit-lock market sells can conflict (double-sell / reject)

**Where:** After every market buy we place a **limit sell** at 0.97 for the same shares. Profit lock can later trigger **market sell** (trail, collapse, flatten) for the same position.

**Issue:** Both are live at once. When profit lock does a market sell:
- Exchange may reject if the same size is already in a limit order, or
- We may effectively sell twice (limit fills later) if the exchange allows, or
- We don’t cancel the limit order when we market sell, so the limit can fill after we thought we were flat.

**Risk:** Rejected market sells, inconsistent position state, or accidental double size sold. Operational confusion when position is “closed” by profit lock but a limit still sits.

**Recommendation (for later):** Cancel (or reduce size of) the limit order whenever profit lock sells any of that position, or do not place the limit until profit lock has fully exited.

---

## 3. No check that position belongs to current market (safety / correctness)

**Where:** Main loop uses `position` and `market`; `tokenId` is derived from `position.outcome` and current `market`’s up/down tokenIds.

**Issue:** There is no assert or check that `position.conditionId === marketInfo.conditionId`. If state ever diverges (bug, race, or future refactor), we would sell the **wrong** token (different market), leaving the real position open and possibly losing funds.

**Risk:** Low probability today (market switch clears position), but high impact: wrong-market trades and orphaned positions.

**Recommendation (for later):** At the start of the “if (position)” block, if `position.conditionId !== marketInfo.conditionId`, clear position and log; do not trade.

---

## 4. Stale or null price used as fallback for sell (execution / slippage)

**Where:** Sell price = `priceStream.getBestAsk(tokenId) ?? position.entryPrice`. When quote is null (disconnected or stale), we use **entry price**.

**Issue:** Entry can be far from current market (e.g. entry 0.85, real bid 0.72). Selling at 0.85 may not fill or may fill only when the market rallies. In a collapse we want to exit quickly; using a stale or wrong price can delay exit or cause large slippage when it does fill.

**Risk:** In disconnect or thin/stale book, we send sells at unrealistic levels; worse P&L or failure to exit before resolution.

**Recommendation (for later):** Prefer best bid when available; if quote is null/stale, consider skipping sell this tick and retrying, or use a conservative fallback (e.g. tick above 0 or mid minus a buffer), and log clearly.

---

## 5. Velocity is BTC spot; market is 5‑minute resolution (basis / timing risk)

**Where:** Velocity comes from Binance spot over a 30s window. The contract resolves on BTC move over the **full 5 minutes**.

**Issue:** Short-term spot velocity can diverge from the outcome that actually resolves the market (e.g. velocity turns “favorable” in the last 30s but the 5m move was already against us). We might:
- Not collapse because velocity is “favorable” while the token is already pricing a loss, or
- Block a good buy because velocity is “adverse” even though the 5m window will end in our favor.

**Risk:** Direction-aware and insufficient-momentum logic are tuned to spot, not resolution; occasional wrong collapse/skip or wrong block/reduce.

**Recommendation (for later):** Document and, if needed, add a “resolution soon” override (e.g. last 30–60s: rely more on token price and less on velocity for collapse).

---

## 6. marketInfo.endTime / startTime vs actual resolution (timing risk)

**Where:** `marketInfo.startTime` and `endTime` come from Gamma API (event start) + `config.WINDOW_SEC`. Flatten uses `elapsedMin = (nowSec - marketStartSec) / 60` and `flattenByMin`.

**Issue:** If API start/end or bot clock differ from the real resolution time, we flatten too early or too late. Too early → give up upside; too late → hold into resolution and take resolution P&L instead of our chosen exit.

**Risk:** Systematic timing error in flatten; worse or different P&L than intended.

**Recommendation (for later):** Optionally validate or nudge end time (e.g. from exchange or resolution feed); log when flatten fires vs expected resolution.

---

## 7. Partial fill on market sell not retried in same tick (inventory risk)

**Where:** We call `marketSell` once per signal; `position.remainingShares` is decremented by `filledShares`. If the fill is partial, we keep the rest and rely on the next loop.

**Issue:** In fast markets the next tick might see a different signal (e.g. trail level crossed again) or worse liquidity. We don’t retry the **same** sell in the same tick for the unfilled remainder.

**Risk:** Moderate: we usually close over a few ticks, but in a gap or thin book we might hold residual size longer than intended or at worse average price.

**Recommendation (for later):** Optional: on partial fill, retry sell for `remainingShares` once or twice in the same tick (with rate/backoff to avoid hammering the API).

---

## 8. No validation that we’re still in the same market after switch (race)

**Where:** `onMarketClosed` calls `getCurrentMarket()`. If it returns **null** or the **same** conditionId, we don’t switch; we keep the old `market` and subscription.

**Issue:** After `marketEndTimeSec` we may already be past resolution but still subscribed to the old market (e.g. API lag or same-market response). We could keep running profit lock or even try to trade on a **resolved** market.

**Risk:** Trades or logic applied to a market that has already resolved; undefined behavior and possible loss.

**Recommendation (for later):** After end time, treat “no new market yet” as a special state (e.g. no new buys, only allow closing existing position once, then pause until next market is known).

---

## 9. Velocity null → collapse allowed (conservative but can over-cut)

**Where:** When `velocitySigned` is null we pass `velocityAdverse = undefined`; profit lock then allows collapse at adverse ≥ 0.10.

**Issue:** If the velocity sampler is down or not yet ready, we behave like “velocity adverse”: we collapse on drawdown. That avoids holding with no signal, but we might collapse in a temporarily favorable move (e.g. brief API blip) and lock a loss.

**Risk:** Over-aggressive collapse when velocity is unavailable; acceptable as a safe default but worth documenting.

---

## 10. T1/T2 use “shares” (original size); fractional and rounding

**Where:** `sellShares = position.shares * signal.sizeRatio` (e.g. 5 × 0.3 = 1.5). We pass that to `marketSell`; exchange may round.

**Issue:** Small positions (e.g. 2 shares) give 0.6 at T1; rounding can sell 1 and “over-fulfill” the 30% for that leg. Minor P&L and sizing skew.

**Risk:** Low; mainly documentation and monitoring of small-size behavior.

---

## 11. highWaterMark can be stale when quotes are stale

**Where:** `highWaterMark` is updated only when `mid != null && mid > position.highWaterMark`. Profit lock uses `mid ?? position.entryPrice` when mid is null.

**Issue:** If we’re disconnected or quotes are stale, mid can be null and we use entry for decisions; we don’t update highWaterMark. So trail level stays at an old high and may trigger too late (we think we’re above trail when we’re not) or not trigger when we’re already below (stale mid).

**Risk:** Trail fires at wrong time or doesn’t fire when it should under disconnect/stale data.

---

## 12. Insufficient momentum uses raw $ move, not token space

**Where:** `projectedMoveUsd = leftTimeSec * velocity` (in $). Compared to `INSUFFICIENT_MOMENTUM_MIN_PROJECTED_USD` (e.g. 50).

**Issue:** Token price move per $ of BTC is not 1:1. So “50 $ projected” doesn’t map directly to “we won’t reach T1.” We might tighten when we could have reached T1, or not tighten when we couldn’t.

**Risk:** Heuristic is approximate; occasional unnecessary tightening or late tightening. Acceptable if treated as a simple proxy.

---

## 13. Config and env can make thresholds inconsistent

**Where:** Many numeric thresholds (ALPHA1/2, R1/R2, collapse, velocity block/reduce/tighten, flatten, etc.) from env with defaults.

**Issue:** E.g. FLATTEN_BY_MIN > market window in minutes (e.g. 4.5 min flatten in a 5 min window is fine; 5.5 would never fire). Or collapse threshold and trail/flatten ordering can make some paths unreachable if mis-set.

**Risk:** Misconfiguration can disable or over-trigger parts of the system; needs validation or documented “safe ranges.”

---

## Summary table

| # | Area | Severity | One-line |
|---|------|----------|----------|
| 1 | Execution | High | Sell uses best ask; should use best bid for sell price. |
| 2 | Orders | High | Limit @ 0.97 and profit-lock market sells can conflict; no cancel. |
| 3 | Safety | Medium | No check position.conditionId === marketInfo.conditionId. |
| 4 | Execution | Medium | Stale/null price fallback to entry can cause bad or no fill. |
| 5 | Logic | Medium | Velocity is spot; resolution is 5m; basis/timing mismatch. |
| 6 | Timing | Medium | Flatten uses API/clock; may not match real resolution time. |
| 7 | Execution | Low | Partial fill not retried same tick. |
| 8 | Race | Medium | After end time, may keep trading on resolved market if API lags. |
| 9 | Logic | Low | Velocity null → collapse allowed (document). |
| 10 | Sizing | Low | T1/T2 fractional shares and rounding. |
| 11 | Data | Low | highWaterMark stale when quotes stale. |
| 12 | Logic | Low | Insufficient momentum in $ not token space. |
| 13 | Config | Low | Env thresholds can be inconsistent or unsafe. |

These are the main issues and risks a senior trading bot developer would flag; no code was changed.
