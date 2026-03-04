"""
PostgreSQL schema and access for vol_regime_history.
"""
import asyncpg
from config import DATABASE_URL

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS vol_regime_history (
    timestamp TIMESTAMPTZ NOT NULL PRIMARY KEY,
    rv_short DOUBLE PRECISION NOT NULL,
    rv_long DOUBLE PRECISION NOT NULL,
    vol_ratio DOUBLE PRECISION NOT NULL,
    range_expansion DOUBLE PRECISION NOT NULL,
    vol_accel DOUBLE PRECISION NOT NULL,
    regime_score DOUBLE PRECISION NOT NULL,
    kelly_multiplier DOUBLE PRECISION NOT NULL,
    threshold_multiplier DOUBLE PRECISION NOT NULL,
    shrink_multiplier DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vol_regime_history_timestamp ON vol_regime_history (timestamp DESC);
"""


async def get_pool():
    return await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4, command_timeout=10)


async def init_db(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLE_SQL)


async def insert_regime(
    pool: asyncpg.Pool,
    *,
    timestamp,
    rv_short: float,
    rv_long: float,
    vol_ratio: float,
    range_expansion: float,
    vol_accel: float,
    regime_score: float,
    kelly_multiplier: float,
    threshold_multiplier: float,
    shrink_multiplier: float,
):
    await pool.execute(
        """
        INSERT INTO vol_regime_history (
            timestamp, rv_short, rv_long, vol_ratio, range_expansion, vol_accel,
            regime_score, kelly_multiplier, threshold_multiplier, shrink_multiplier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (timestamp) DO UPDATE SET
            rv_short = EXCLUDED.rv_short,
            rv_long = EXCLUDED.rv_long,
            vol_ratio = EXCLUDED.vol_ratio,
            range_expansion = EXCLUDED.range_expansion,
            vol_accel = EXCLUDED.vol_accel,
            regime_score = EXCLUDED.regime_score,
            kelly_multiplier = EXCLUDED.kelly_multiplier,
            threshold_multiplier = EXCLUDED.threshold_multiplier,
            shrink_multiplier = EXCLUDED.shrink_multiplier
        """,
        timestamp,
        rv_short,
        rv_long,
        vol_ratio,
        range_expansion,
        vol_accel,
        regime_score,
        kelly_multiplier,
        threshold_multiplier,
        shrink_multiplier,
    )


async def get_history(pool: asyncpg.Pool, hours: float = 24):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT timestamp, rv_short, rv_long, vol_ratio, range_expansion, vol_accel,
                   regime_score, kelly_multiplier, threshold_multiplier, shrink_multiplier
            FROM vol_regime_history
            WHERE timestamp >= NOW() - ($1::float * INTERVAL '1 hour')
            ORDER BY timestamp ASC
            """,
            hours,
        )
    return [
        {
            "timestamp": r["timestamp"].isoformat() if hasattr(r["timestamp"], "isoformat") else str(r["timestamp"]),
            "rv_short": float(r["rv_short"]),
            "rv_long": float(r["rv_long"]),
            "vol_ratio": float(r["vol_ratio"]),
            "range_expansion": float(r["range_expansion"]),
            "vol_accel": float(r["vol_accel"]),
            "regime_score": float(r["regime_score"]),
            "kelly_multiplier": float(r["kelly_multiplier"]),
            "threshold_multiplier": float(r["threshold_multiplier"]),
            "shrink_multiplier": float(r["shrink_multiplier"]),
        }
        for r in rows
    ]


async def get_latest(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT timestamp, rv_short, rv_long, vol_ratio, range_expansion, vol_accel,
                   regime_score, kelly_multiplier, threshold_multiplier, shrink_multiplier
            FROM vol_regime_history
            ORDER BY timestamp DESC
            LIMIT 1
            """
        )
    if not row:
        return None
    return {
        "timestamp": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else str(row["timestamp"]),
        "rv_short": float(row["rv_short"]),
        "rv_long": float(row["rv_long"]),
        "vol_ratio": float(row["vol_ratio"]),
        "range_expansion": float(row["range_expansion"]),
        "vol_accel": float(row["vol_accel"]),
        "regime_score": float(row["regime_score"]),
        "kelly_multiplier": float(row["kelly_multiplier"]),
        "threshold_multiplier": float(row["threshold_multiplier"]),
        "shrink_multiplier": float(row["shrink_multiplier"]),
    }
