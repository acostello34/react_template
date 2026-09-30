"""Deterministic mock product catalogue, as a Pandas DataFrame.

Stands in for whatever the real source is — a warehouse query, a parquet file,
a cached extract. The endpoint only assumes "a DataFrame with these columns",
so swapping this module out changes nothing above it.
"""

from __future__ import annotations

from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd

CATEGORIES = ["Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Liqueur"]
STATUSES = ["active", "draft", "discontinued"]
SUPPLIERS = ["Highland Cask", "Northern Still", "Blue Agave Co.", "Harbour Imports"]

#: Columns the single-box `q` search scans.
SEARCH_COLUMNS = ["name", "sku"]

#: Columns that may be sorted on. An allowlist, so `sort_by` can't reach
#: arbitrary attributes or blow up on a column that isn't orderable.
SORTABLE_COLUMNS = ["name", "sku", "category", "status", "price", "stock", "rating", "created_at"]


@lru_cache(maxsize=1)
def get_products() -> pd.DataFrame:
    """Build the frame once per process and cache it.

    Callers must treat the result as read-only — filter into a new frame
    rather than mutating this one in place.
    """
    rng = np.random.default_rng(seed=20260925)
    size = 240

    categories = rng.choice(CATEGORIES, size=size)
    # Zero out ~8% of stock levels so "out of stock" is a real case to
    # filter on rather than a branch that never fires.
    stock = np.where(rng.random(size) < 0.08, 0, rng.integers(1, 500, size=size))
    frame = pd.DataFrame(
        {
            "id": [f"prd_{index:04d}" for index in range(1, size + 1)],
            "sku": [f"SKU-{index:05d}" for index in rng.permutation(size) + 1],
            "name": [
                f"{category} {style} {number}"
                for category, style, number in zip(
                    categories,
                    rng.choice(["Reserve", "Small Batch", "Cask Strength", "Classic"], size=size),
                    rng.integers(1, 40, size=size),
                    strict=True,
                )
            ],
            "category": categories,
            "status": rng.choice(STATUSES, size=size, p=[0.7, 0.2, 0.1]),
            "supplier": rng.choice(SUPPLIERS, size=size),
            "price": np.round(rng.uniform(12.0, 340.0, size=size), 2),
            "stock": stock,
            "rating": np.round(rng.uniform(2.5, 5.0, size=size), 1),
            "created_at": pd.to_datetime("2024-01-01")
            + pd.to_timedelta(rng.integers(0, 640, size=size), unit="D"),
        }
    )
    frame["in_stock"] = frame["stock"] > 0
    return frame


def filter_options() -> dict[str, object]:
    """Powers the select controls in the client's filter bar."""
    frame = get_products()
    return {
        "categories": [
            {"label": value, "value": value} for value in sorted(frame["category"].unique())
        ],
        "statuses": [
            {"label": value.title(), "value": value} for value in sorted(frame["status"].unique())
        ],
        "suppliers": [
            {"label": value, "value": value} for value in sorted(frame["supplier"].unique())
        ],
        "price": {
            "min": float(frame["price"].min()),
            "max": float(frame["price"].max()),
        },
        "created_at": {
            "min": _as_date(frame["created_at"].min()),
            "max": _as_date(frame["created_at"].max()),
        },
    }


def _as_date(value: pd.Timestamp) -> date:
    return value.date()
