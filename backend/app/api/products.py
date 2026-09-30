"""Product listing endpoint: optional filter params in, filtered JSON out.

Every parameter is optional and absent means "don't narrow on this". The
param names match what the client's `buildQueryParams` emits, so a column
gains a filter on the frontend and lands here without a translation layer:

    name        -> substring on `name`
    category    -> repeated param, `in` on `category`
    price_min   -> inclusive lower bound
    created_at_from / created_at_to -> inclusive date window
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

import pandas as pd
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.core.errors import AppError, build_metadata
from app.data.products import SEARCH_COLUMNS, SORTABLE_COLUMNS, filter_options, get_products
from app.schemas.response import APIResponse

router = APIRouter(prefix="/api/v1/products", tags=["products"])


class ProductOut(BaseModel):
    id: str
    sku: str
    name: str
    category: str
    status: str
    supplier: str
    price: float
    stock: int
    rating: float
    in_stock: bool
    created_at: date


class FilterOptionsOut(BaseModel):
    categories: list[dict[str, str]]
    statuses: list[dict[str, str]]
    suppliers: list[dict[str, str]]
    price: dict[str, float]
    created_at: dict[str, date]


@router.get("/filters", response_model=APIResponse[FilterOptionsOut])
async def get_filter_options(request: Request) -> APIResponse[FilterOptionsOut]:
    """Populates the select controls, so options track the data."""
    return APIResponse[FilterOptionsOut].ok(
        FilterOptionsOut.model_validate(filter_options()),
        metadata=build_metadata(request),
    )


@router.get("", response_model=APIResponse[list[ProductOut]])
async def list_products(
    request: Request,
    # -- filters ---------------------------------------------------- #
    q: Annotated[str | None, Query(description="Substring search across name and SKU.")] = None,
    name: Annotated[str | None, Query(description="Substring match on name.")] = None,
    category: Annotated[list[str] | None, Query(description="Repeatable.")] = None,
    status: Annotated[list[str] | None, Query(description="Repeatable.")] = None,
    supplier: Annotated[list[str] | None, Query()] = None,
    price_min: Annotated[float | None, Query(ge=0)] = None,
    price_max: Annotated[float | None, Query(ge=0)] = None,
    stock_min: Annotated[int | None, Query(ge=0)] = None,
    stock_max: Annotated[int | None, Query(ge=0)] = None,
    rating_min: Annotated[float | None, Query(ge=0, le=5)] = None,
    in_stock: Annotated[bool | None, Query()] = None,
    created_at_from: Annotated[date | None, Query()] = None,
    created_at_to: Annotated[date | None, Query()] = None,
    # -- sorting and paging ----------------------------------------- #
    sort_by: Annotated[str | None, Query()] = None,
    sort_order: Annotated[Literal["asc", "desc"], Query()] = "asc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 20,
) -> APIResponse[list[ProductOut]]:
    frame = get_products()

    # One boolean mask, narrowed per supplied parameter. Building the mask
    # rather than reassigning `frame` keeps a single pass over the index and
    # makes each condition independently readable.
    mask = pd.Series(True, index=frame.index)

    if q:
        # regex=False: the value is user input, not a pattern — a stray "("
        # would otherwise raise, and a crafted one would be a ReDoS.
        text = pd.Series(False, index=frame.index)
        for column in SEARCH_COLUMNS:
            text |= frame[column].str.contains(q, case=False, na=False, regex=False)
        mask &= text

    if name:
        mask &= frame["name"].str.contains(name, case=False, na=False, regex=False)
    if category:
        mask &= frame["category"].isin(category)
    if status:
        mask &= frame["status"].isin(status)
    if supplier:
        mask &= frame["supplier"].isin(supplier)
    if price_min is not None:
        mask &= frame["price"] >= price_min
    if price_max is not None:
        mask &= frame["price"] <= price_max
    if stock_min is not None:
        mask &= frame["stock"] >= stock_min
    if stock_max is not None:
        mask &= frame["stock"] <= stock_max
    if rating_min is not None:
        mask &= frame["rating"] >= rating_min
    if in_stock is not None:
        mask &= frame["in_stock"] == in_stock
    if created_at_from is not None:
        mask &= frame["created_at"] >= pd.Timestamp(created_at_from)
    if created_at_to is not None:
        # Inclusive of the whole end day, whatever time component the data has.
        mask &= frame["created_at"] < pd.Timestamp(created_at_to) + pd.Timedelta(days=1)

    # .loc on a mask returns a copy, so the cached frame is never touched.
    filtered = frame.loc[mask]

    if sort_by:
        if sort_by not in SORTABLE_COLUMNS:
            raise AppError(
                f"Cannot sort by {sort_by!r}.",
                code="invalid_sort_field",
                status_code=400,
            )
        filtered = filtered.sort_values(
            by=sort_by, ascending=sort_order == "asc", kind="stable"
        )

    total_items = int(len(filtered))
    start = (page - 1) * page_size
    window = filtered.iloc[start : start + page_size]

    return APIResponse[list[ProductOut]].paginated(
        [ProductOut.model_validate(record) for record in _records(window)],
        page=page,
        page_size=page_size,
        total_items=total_items,
        metadata=build_metadata(request),
    )


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """DataFrame rows as plain dicts.

    `to_dict` hands back numpy scalars (np.int64, np.bool_), which Pydantic
    rejects, so cast to object dtype first — that unboxes each value to its
    Python equivalent. Timestamps become dates here rather than in the model,
    where a datetime with a time component would fail validation.
    """
    if frame.empty:
        return []
    prepared = frame.assign(created_at=frame["created_at"].dt.date)
    return prepared.astype(object).to_dict(orient="records")
