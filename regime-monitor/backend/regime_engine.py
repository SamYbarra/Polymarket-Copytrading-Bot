"""
Regime engine: from BTC price series compute RV short/long, vol_ratio, regime_score, multipliers.
Uses 1-minute log returns; short window = last N bars, long = longer lookback.
"""
import math
from dataclasses import dataclass
from datetime import datetime, timezone

from config import REGIME_SHORT_WINDOW, REGIME_LONG_WINDOW


@dataclass
class RegimeSnapshot:
    timestamp: datetime
    rv_short: float
    rv_long: float
    vol_ratio: float
    range_expansion: float
    vol_accel: float
    regime_score: float
    kelly_multiplier: float
    threshold_multiplier: float
    shrink_multiplier: float
    classification: str  # LOW | NORMAL | HIGH | EXTREME


def _std(arr: list[float]) -> float:
    if len(arr) < 2:
        return 0.0
    n = len(arr)
    mean = sum(arr) / n
    var = sum((x - mean) ** 2 for x in arr) / (n - 1)
    return math.sqrt(max(0, var))


def _quantile(arr: list[float], q: float) -> float:
    if not arr:
        return 0.0
    s = sorted(arr)
    i = (len(s) - 1) * q
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    if lo == hi:
        return s[lo]
    return s[lo] * (1 - (i - lo)) + s[hi] * (i - lo)


class RegimeEngine:
    """Maintains rolling prices and computes regime metrics from 1-minute log returns."""

    def __init__(self):
        self._prices: list[tuple[datetime, float]] = []
        self._max_points = (REGIME_LONG_WINDOW + 5) * 120  # keep ~2 per minute for 20+ min
        self._prev_price: float | None = None

    def push_price(self, ts: datetime, price: float) -> None:
        if price <= 0:
            return
        self._prices.append((ts, price))
        if len(self._prices) > self._max_points:
            self._prices.pop(0)
        self._prev_price = price

    def _minute_bars(self) -> list[tuple[datetime, float]]:
        """Group by minute (UTC), use last price in each minute."""
        if not self._prices:
            return []
        by_minute: dict[tuple[int, int, int, int, int], list[tuple[datetime, float]]] = {}
        for ts, p in self._prices:
            key = (ts.year, ts.month, ts.day, ts.hour, ts.minute)
            by_minute.setdefault(key, []).append((ts, p))
        bars = []
        for key in sorted(by_minute.keys()):
            pts = by_minute[key]
            # use last (most recent) price in the minute
            pts.sort(key=lambda x: x[0])
            ts_last, p_last = pts[-1]
            bars.append((ts_last, p_last))
        return bars

    def _log_returns(self) -> list[float]:
        bars = self._minute_bars()
        out = []
        for i in range(1, len(bars)):
            p0, p1 = bars[i - 1][1], bars[i][1]
            if p0 > 0:
                out.append(math.log(p1 / p0))
        return out

    def compute(self, timestamp: datetime | None = None) -> RegimeSnapshot | None:
        ts = timestamp or datetime.now(timezone.utc)
        returns = self._log_returns()
        if len(returns) < REGIME_SHORT_WINDOW:
            return None

        short_returns = returns[-REGIME_SHORT_WINDOW:]
        long_returns = returns[-REGIME_LONG_WINDOW:] if len(returns) >= REGIME_LONG_WINDOW else returns

        rv_short = _std(short_returns)
        rv_long = _std(long_returns) if long_returns else rv_short

        # Vol ratio: short/long (elevated when recent vol > baseline)
        vol_ratio = (rv_short / rv_long) if rv_long > 1e-12 else (rv_short * 100.0)

        # Range expansion: how much recent range exceeds long-run (simplified: ratio of ranges)
        range_short = max(short_returns) - min(short_returns) if short_returns else 0.0
        range_long = max(long_returns) - min(long_returns) if long_returns else 0.0
        range_expansion = (range_short / range_long) if range_long > 1e-12 else 1.0

        # Vol acceleration: short RV vs previous short window
        prev_short = returns[-(REGIME_SHORT_WINDOW * 2) : -REGIME_SHORT_WINDOW] if len(returns) >= REGIME_SHORT_WINDOW * 2 else short_returns
        rv_prev = _std(prev_short) if len(prev_short) >= 2 else rv_short
        vol_accel = (rv_short / rv_prev) if rv_prev > 1e-12 else 1.0

        # Regime score in [0, 1]: higher = more volatile/risky
        vol_ratio_norm = max(0, min(2.0, vol_ratio))
        term_vol = 0.4 * max(0, vol_ratio_norm - 0.5)
        term_range = 0.3 * max(0, min(1.0, range_expansion - 0.5))
        term_accel = 0.2 * max(0, min(1.0, vol_accel - 0.5))
        regime_score = max(0.0, min(1.0, term_vol + term_range + term_accel + 0.35))

        # Multipliers: risk reduction in high regime
        kelly_multiplier = max(0.2, 1.0 - 0.8 * regime_score)
        threshold_multiplier = 1.0 + 0.5 * regime_score  # wider thresholds in high vol
        shrink_multiplier = max(0.3, 1.0 - 0.6 * regime_score)  # probability shrink

        classification = _classify(regime_score)

        return RegimeSnapshot(
            timestamp=ts,
            rv_short=rv_short,
            rv_long=rv_long,
            vol_ratio=vol_ratio,
            range_expansion=range_expansion,
            vol_accel=vol_accel,
            regime_score=regime_score,
            kelly_multiplier=kelly_multiplier,
            threshold_multiplier=threshold_multiplier,
            shrink_multiplier=shrink_multiplier,
            classification=classification,
        )


def _classify(score: float) -> str:
    if score < 0.3:
        return "LOW"
    if score < 0.6:
        return "NORMAL"
    if score < 0.8:
        return "HIGH"
    return "EXTREME"
