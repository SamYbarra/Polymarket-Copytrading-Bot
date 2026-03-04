#!/usr/bin/env python3
"""
Export resolved predictions from MongoDB to CSV for training or inspection.
"""

import os
import csv
import argparse
from pathlib import Path

from pymongo import MongoClient
from dotenv import load_dotenv

from feature_columns import FEATURE_COLUMNS

load_dotenv()

DEFAULT_MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DEFAULT_MONGODB_DB = os.getenv("MONGODB_DB", "polymarket_btc5")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mongodb-uri", default=DEFAULT_MONGODB_URI)
    parser.add_argument("--mongodb-db", default=DEFAULT_MONGODB_DB)
    parser.add_argument("-o", "--output", default="training_data.csv")
    args = parser.parse_args()

    client = MongoClient(args.mongodb_uri)
    db = client[args.mongodb_db]
    cursor = db.predictions.find(
        {"actualOutcome": {"$in": ["Up", "Down"]}},
        projection={"conditionId", "actualOutcome", "features"},
    )

    fieldnames = ["conditionId", "actualOutcome"] + FEATURE_COLUMNS
    count = 0
    with open(args.output, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for doc in cursor:
            feat = doc.get("features") or {}
            row = {"conditionId": doc.get("conditionId"), "actualOutcome": doc.get("actualOutcome")}
            for c in FEATURE_COLUMNS:
                row[c] = feat.get(c, 0)
            w.writerow(row)
            count += 1
    client.close()
    print(f"Exported {count} rows to {args.output}")


if __name__ == "__main__":
    main()
