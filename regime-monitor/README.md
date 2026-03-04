# Regime Monitor — Risk Governor Dashboard

Three-layer system for **visual volatility regime monitoring**:

```
BTC Price Feed → Regime Engine (calculation + storage) → API Service → Frontend Dashboard
```

## Backend (Python FastAPI)

- **Database**: PostgreSQL table `vol_regime_history` (timestamp, rv_short, rv_long, vol_ratio, range_expansion, vol_accel, regime_score, kelly_multiplier, threshold_multiplier, shrink_multiplier).
- **Endpoints**:
  - `GET /regime/current` — latest regime snapshot (classification, multipliers).
  - `GET /regime/history?hours=24` — time series for charts.
  - `WS /ws/regime` — live updates every ~1s.
- **Regime engine**: 1-minute log returns from BTC price; short/long RV windows; vol_ratio, regime_score, and risk multipliers.

### Run backend

```bash
cd regime-monitor/backend
# If you have python3-venv: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Else (e.g. Debian): pip3 install -r requirements.txt --break-system-packages
cp .env.example .env       # set DATABASE_URL and optional BTC_PRICE_URL
# Create DB: createdb regime_db (optional; runs without DB for live-only)
uvicorn main:app --host 0.0.0.0 --port 8006
```

### Run with PM2

From repo root or `regime-monitor/`:

```bash
cd regime-monitor
# Backend: ensure deps installed (pip3 install -r backend/requirements.txt ...)
# Frontend: npm install && npm run build in frontend/
pm2 start ecosystem.config.cjs
pm2 save   # optional: persist for reboot
```

- **regime-api**: http://localhost:8006  
- **regime-dashboard**: http://localhost:3001  

## Frontend (Next.js)

- **Live Regime Gauge** — circular gauge (green → yellow → orange → red for 0–0.3 → 0.8–1).
- **VolRatio chart** — time series with Q25/Q75/Q90 reference lines.
- **Regime Score chart** — score over time.
- **Multiplier panel** — Kelly, Threshold, Probability Shrink, Momentum Weight Adj.
- **History table** — sortable, Export CSV.
- **Safety alert** — flashes when Regime Score > 0.85: "⚠ EXTREME VOLATILITY — Risk Reduction Activated".

### Run frontend

```bash
cd regime-monitor/frontend
npm install
# Optional: echo "NEXT_PUBLIC_REGIME_API=http://localhost:8006" >> .env.local
npm run dev
```

Open http://localhost:3001. Backend must be running on port 8006 (or set `NEXT_PUBLIC_REGIME_API`).

## Live update flow

- Every 1s the backend fetches BTC price, pushes to the regime engine, computes regime, writes to DB, and broadcasts via WebSocket.
- Frontend subscribes to WebSocket and polls `/regime/history` periodically for chart data.
- Target latency: &lt; 200ms from price to dashboard update.

## Optional advanced visuals (future)

- Heatmap: regime vs model performance.
- Scatter: RegimeScore vs trade PnL.
- Distribution histogram of VolRatio.

## Integration with trading stack

The regime layer sits as **risk governor** between ensemble model and capital allocation:

```
Wallet Model + Momentum Model → Ensemble Model → Regime Layer (Risk Governor) → Capital Allocation → Profit Lock Engine → Execution
```

You now visually monitor the “risk brain” so regime changes are transparent and early warnings are visible.
