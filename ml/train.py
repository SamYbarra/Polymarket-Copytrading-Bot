#!/usr/bin/env python3
"""
XGBoost training pipeline for BTC 5m Up/Down prediction.
Reads resolved predictions from MongoDB, trains a binary classifier, saves model and feature list.
"""

import os
import sys
import json
import argparse
import time
from pathlib import Path

import numpy as np
import xgboost as xgb
from pymongo import MongoClient
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
from dotenv import load_dotenv

from feature_columns import FEATURE_COLUMNS, LABEL_UP, LABEL_DOWN

# Load .env from ml/ so it works when run from repo root or from ml/
load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv()  # also allow cwd .env to override

DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "artifacts"
# Require MONGODB_URI in env (or --mongodb-uri); no hardcoded credentials
DEFAULT_MONGODB_URI = os.getenv("MONGODB_URI", "")
DEFAULT_MONGODB_DB = os.getenv("MONGODB_DB", "polymarket_btc5")


def load_training_data_from_mongodb(
    uri: str,
    db_name: str,
    traded_only: bool = False,
    min_samples: int = 30,
    max_days: int | None = None,
):
    """Load predictions with actualOutcome set and build X, y arrays. Sorted by predictedAt for time-based split.
    If max_days is set, only predictions with predictedAt >= (now - max_days * 86400) are loaded."""
    if not (uri or "").strip():
        raise ValueError("MONGODB_URI is not set. Set it in ml/.env or pass --mongodb-uri.")
    client = MongoClient(uri)
    try:
        # Verify connection (PyMongo connects lazily; ping gives a clear error if URI is wrong)
        client.admin.command("ping")
        db = client[db_name]

        traded_condition_ids = None
        if traded_only:
            traded_docs = list(db.ml_buys.find({}, projection={"conditionId": 1}))
            traded_condition_ids = {d["conditionId"] for d in traded_docs}
            if len(traded_condition_ids) < min_samples:
                raise ValueError(
                    f"traded_only=True but only {len(traded_condition_ids)} traded markets in ml_buys (need >= {min_samples})"
                )

        query = {"actualOutcome": {"$in": ["Up", "Down"]}}
        if traded_condition_ids is not None:
            query["conditionId"] = {"$in": list(traded_condition_ids)}
        if max_days is not None and max_days > 0:
            cutoff_ts = int(time.time()) - max_days * 86400
            query["predictedAt"] = {"$gte": cutoff_ts}

        cursor = db.predictions.find(
            query,
            projection={"features": 1, "actualOutcome": 1, "predictedAt": 1},
        ).sort("predictedAt", 1)

        rows = list(cursor)
    finally:
        client.close()

    if not rows:
        return None, None

    X_list = []
    y_list = []
    for doc in rows:
        feat = doc.get("features")
        if not feat:
            continue
        row = [float(feat.get(c, 0)) for c in FEATURE_COLUMNS]
        X_list.append(row)
        y_list.append(LABEL_UP if doc["actualOutcome"] == "Up" else LABEL_DOWN)

    return np.array(X_list, dtype=np.float64), np.array(y_list, dtype=np.int32)


def load_training_data_from_csv(csv_path: str):
    """Load from CSV with columns: actualOutcome, then FEATURE_COLUMNS."""
    import csv
    X_list, y_list = [], []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            outcome = row.get("actualOutcome", "").strip()
            if outcome not in ("Up", "Down"):
                continue
            y_list.append(LABEL_UP if outcome == "Up" else LABEL_DOWN)
            X_list.append([float(row.get(c, 0)) for c in FEATURE_COLUMNS])
    return np.array(X_list, dtype=np.float64), np.array(y_list, dtype=np.int32)


def train(
    data_source: str,
    mongodb_uri: str,
    mongodb_db: str,
    csv_path: str | None,
    model_dir: Path,
    test_size: float = 0.2,
    random_state: int = 42,
    time_split: bool = True,
    traded_only: bool = False,
    min_samples: int = 30,
    max_days: int | None = None,
):
    if data_source == "mongodb":
        X, y = load_training_data_from_mongodb(
            mongodb_uri,
            mongodb_db,
            traded_only=traded_only,
            min_samples=min_samples,
            max_days=max_days,
        )
    else:
        if not csv_path:
            print("Error: --csv required when data_source=csv", file=sys.stderr)
            sys.exit(1)
        X, y = load_training_data_from_csv(csv_path)

    if X is None or len(X) < min_samples:
        print(
            f"Error: need at least {min_samples} resolved predictions. Got {len(X) if X is not None else 0}.",
            file=sys.stderr,
        )
        sys.exit(1)

    if max_days is not None and max_days > 0 and data_source == "mongodb":
        print(f"Lookback window: last {max_days} days ({len(X)} samples)")

    if time_split and data_source == "mongodb":
        n_test = max(1, int(len(X) * test_size))
        n_train = len(X) - n_test
        X_train, X_test = X[:n_train], X[n_train:]
        y_train, y_test = y[:n_train], y[n_train:]
        print(f"Time-based split: train {n_train} (oldest), test {n_test} (newest)")
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )
        print("Random split (stratified)")

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=random_state,
        use_label_encoder=False,
    )
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print("Test accuracy:", round(acc, 4))
    print(classification_report(y_test, y_pred, target_names=["Down", "Up"]))

    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "model.json"
    model.save_model(str(model_path))
    with open(model_dir / "feature_names.json", "w") as f:
        json.dump(FEATURE_COLUMNS, f, indent=2)
    print(f"Model and feature list saved to {model_dir}")
    return model


def main():
    parser = argparse.ArgumentParser(description="Train XGBoost on resolved predictions")
    parser.add_argument(
        "--data",
        choices=["mongodb", "csv"],
        default="mongodb",
        help="Data source: mongodb or csv",
    )
    parser.add_argument("--mongodb-uri", default=DEFAULT_MONGODB_URI)
    parser.add_argument("--mongodb-db", default=DEFAULT_MONGODB_DB)
    parser.add_argument("--csv", help="Path to CSV when --data=csv")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--no-time-split",
        action="store_true",
        help="Use random train/test split instead of time-based (test = newest)",
    )
    parser.add_argument(
        "--traded-only",
        action="store_true",
        help="Train only on predictions we actually traded (ml_buys); need >= min-samples",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=50,
        help="Minimum resolved predictions required to train (default 50)",
    )
    parser.add_argument(
        "--max-days",
        type=int,
        default=None,
        metavar="N",
        help="Only use predictions from the last N days (reduces concept drift; e.g. 21 for ~3 weeks)",
    )
    args = parser.parse_args()

    train(
        data_source=args.data,
        mongodb_uri=args.mongodb_uri,
        mongodb_db=args.mongodb_db,
        csv_path=args.csv,
        model_dir=args.model_dir,
        test_size=args.test_size,
        random_state=args.seed,
        time_split=not args.no_time_split,
        traded_only=args.traded_only,
        min_samples=args.min_samples,
        max_days=args.max_days,
    )


if __name__ == "__main__":
    main()
