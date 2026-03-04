"""
BTC price feed: fetch spot price (Binance primary, optional fallback).
"""
import httpx
from config import BTC_PRICE_URL, BTC_FALLBACK_URL


async def get_btc_price_usd() -> float | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(BTC_PRICE_URL)
            r.raise_for_status()
            data = r.json()
            if "price" in data:
                p = float(data["price"])
                return p if p > 0 else None
            return None
    except Exception:
        pass
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(BTC_FALLBACK_URL)
            r.raise_for_status()
            data = r.json()
            p = data.get("bitcoin", {}).get("usd")
            if p is not None and isinstance(p, (int, float)) and p > 0:
                return float(p)
    except Exception:
        pass
    return None
