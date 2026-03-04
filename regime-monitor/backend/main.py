"""
Regime Monitor API: BTC price → Regime Engine → storage + GET /regime/current, /regime/history + WebSocket.
"""
import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import REGIME_UPDATE_INTERVAL_SEC
from db import get_pool, init_db, insert_regime, get_history, get_latest
from price_feed import get_btc_price_usd
from regime_engine import RegimeEngine

# Global state
pool: asyncpg.Pool | None = None
engine = RegimeEngine()
current_snapshot: dict | None = None
ws_clients: list[WebSocket] = []


async def regime_loop():
    """Every REGIME_UPDATE_INTERVAL_SEC: fetch BTC price, push to engine, compute, store, broadcast."""
    global current_snapshot
    while True:
        try:
            price = await get_btc_price_usd()
            if price is not None:
                ts = datetime.now(timezone.utc)
                engine.push_price(ts, price)
                snap = engine.compute(ts)
                if snap is not None:
                    if pool:
                        await insert_regime(
                            pool,
                            timestamp=snap.timestamp,
                            rv_short=snap.rv_short,
                            rv_long=snap.rv_long,
                            vol_ratio=snap.vol_ratio,
                            range_expansion=snap.range_expansion,
                            vol_accel=snap.vol_accel,
                            regime_score=snap.regime_score,
                            kelly_multiplier=snap.kelly_multiplier,
                            threshold_multiplier=snap.threshold_multiplier,
                            shrink_multiplier=snap.shrink_multiplier,
                        )
                    current_snapshot = {
                        "timestamp": snap.timestamp.isoformat(),
                        "regime_score": round(snap.regime_score, 4),
                        "vol_ratio": round(snap.vol_ratio, 4),
                        "kelly_multiplier": round(snap.kelly_multiplier, 4),
                        "threshold_multiplier": round(snap.threshold_multiplier, 4),
                        "shrink_multiplier": round(snap.shrink_multiplier, 4),
                        "momentum_weight_adj": round(max(0.3, 1.0 - 0.5 * snap.regime_score), 4),
                        "classification": snap.classification,
                        "rv_short": snap.rv_short,
                        "rv_long": snap.rv_long,
                        "range_expansion": snap.range_expansion,
                        "vol_accel": snap.vol_accel,
                    }
                    dead = []
                    for ws in ws_clients:
                        try:
                            await ws.send_text(json.dumps(current_snapshot))
                        except Exception:
                            dead.append(ws)
                    for ws in dead:
                        if ws in ws_clients:
                            ws_clients.remove(ws)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"regime_loop error: {e}")
        await asyncio.sleep(REGIME_UPDATE_INTERVAL_SEC)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    try:
        pool = await get_pool()
        await init_db(pool)
        print("Regime backend: PostgreSQL connected.")
    except Exception as e:
        pool = None
        print(f"Regime backend: No DB ({e}). Live regime only (no history persistence).")
    task = asyncio.create_task(regime_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    if pool:
        await pool.close()


app = FastAPI(title="Regime Monitor API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/regime/current")
async def regime_current():
    """Returns latest regime snapshot (from memory or DB)."""
    if current_snapshot:
        return current_snapshot
    if pool:
        row = await get_latest(pool)
        if row:
            # Add classification and momentum_weight_adj for response
            score = row["regime_score"]
            low, normal, high = score < 0.3, 0.3 <= score < 0.6, 0.6 <= score < 0.8
            classification = "EXTREME" if score >= 0.8 else ("HIGH" if high else ("NORMAL" if normal else "LOW"))
            return {
                "timestamp": row["timestamp"],
                "regime_score": row["regime_score"],
                "vol_ratio": row["vol_ratio"],
                "kelly_multiplier": row["kelly_multiplier"],
                "threshold_multiplier": row["threshold_multiplier"],
                "shrink_multiplier": row["shrink_multiplier"],
                "momentum_weight_adj": round(max(0.3, 1.0 - 0.5 * score), 4),
                "classification": classification,
                "rv_short": row["rv_short"],
                "rv_long": row["rv_long"],
                "range_expansion": row["range_expansion"],
                "vol_accel": row["vol_accel"],
            }
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "regime_score": 0.0,
        "vol_ratio": 1.0,
        "kelly_multiplier": 1.0,
        "threshold_multiplier": 1.0,
        "shrink_multiplier": 1.0,
        "momentum_weight_adj": 1.0,
        "classification": "NORMAL",
        "rv_short": 0.0,
        "rv_long": 0.0,
        "range_expansion": 1.0,
        "vol_accel": 1.0,
    }


@app.get("/regime/history")
async def regime_history(hours: float = Query(24, ge=0.1, le=168)):
    """Returns history for plotting (array of regime snapshots)."""
    if not pool:
        return []
    return await get_history(pool, hours=hours)


@app.websocket("/ws/regime")
async def websocket_regime(ws: WebSocket):
    await ws.accept()
    ws_clients.append(ws)
    try:
        if current_snapshot:
            await ws.send_text(json.dumps(current_snapshot))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if ws in ws_clients:
            ws_clients.remove(ws)


if __name__ == "__main__":
    import uvicorn
    from config import API_HOST, API_PORT
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=False)
