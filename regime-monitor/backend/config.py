import os
from pathlib import Path

_env = Path(__file__).resolve().parent / ".env"
if _env.exists():
    from dotenv import load_dotenv
    load_dotenv(_env)

BTC_PRICE_URL = os.getenv("BTC_PRICE_URL", "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
BTC_FALLBACK_URL = os.getenv("BTC_FALLBACK_URL", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/regime_db")
REGIME_SHORT_WINDOW = int(os.getenv("REGIME_SHORT_WINDOW", "3"))
REGIME_LONG_WINDOW = int(os.getenv("REGIME_LONG_WINDOW", "20"))
REGIME_UPDATE_INTERVAL_SEC = float(os.getenv("REGIME_UPDATE_INTERVAL_SEC", "1"))
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8006"))
