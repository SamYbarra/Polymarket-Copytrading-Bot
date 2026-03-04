"""
Feature column order for training and inference. Must match MarketFeatures in src/types.ts.
"""

FEATURE_COLUMNS = [
    "minutesElapsed",
    "btcDeltaPctAtPrediction",
    "hotWalletUpVolume",
    "hotWalletDownVolume",
    "hotWalletImbalance",
    "hotWalletCountUp",
    "hotWalletCountDown",
    "hotWalletAvgWinRateUp",
    "hotWalletAvgWinRateDown",
    "hotWalletTotalVolume",
    "orderbookImbalance",
    "spreadRatio",
    "liquidityRatio",
    "totalVolumeUp",
    "totalVolumeDown",
    "volumeRatio",
    "tradeCountUp",
    "tradeCountDown",
    "largeTradeCountUp",
    "largeTradeCountDown",
]

LABEL_UP = 1
LABEL_DOWN = 0
