# BTC 5m Tracker — Frontend

Plain React (Vite) app that talks to the btc5-tracker backend API. No Next.js.

## Setup

```bash
cp .env.example .env
# Edit .env: set VITE_API_URL if API is not on http://localhost:3002
npm install
```

## Run

- **Dev:** `npm run dev` — Vite dev server at http://localhost:3005
- **Build:** `npm run build` — outputs to `dist/`
- **Preview (built app):** `npm run preview` — serves `dist/` on 3005
- **Production (PM2):** Build once, then PM2 runs `serve -s dist -l 3005` (see root `ecosystem.config.cjs`)

Ensure the **NestJS backend** is running (see `backend/`, default port 3006). The backend proxies to the tracker API (e.g. `npm run api` from repo root, port 3002).

## Structure

- `src/main.tsx` — entry, React Router
- `src/App.tsx` — nav + routes
- `src/pages/` — DashboardPage, WalletsPage, PredictionsPage
- `src/components/` — Nav, Dashboard, CurrentMarketCard, LivePrices, MlPredictionCard, WalletTable, AccuracyCards, PredictionsTable
- `src/lib/` — `api.ts` (fetch wrappers), `types.ts`

Dashboard polls the API every 5s.
