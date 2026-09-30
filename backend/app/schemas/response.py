"""Standard response envelope for every endpoint.

One shape for success and failure alike, so the client has a single branch to
write and a single set of types to generate:

    {
      "status": "success",
      "message": null,
      "data": {...},
      "errors": null,
      "metadata": {"request_id": "...", "timestamp": "...", "duration_ms": 12.4}
    }

Mirrored on the frontend by `src/api/types.ts`.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generic, Self, Sequence, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")

API_VERSION = "1.0"


class ResponseStatus(str, Enum):
    SUCCESS = "success"
    ERROR = "error"
    #: Bulk operations where some items succeeded and some did not; `data`
    #: holds what went through, `errors` explains what did not.
    PARTIAL = "partial"


class ErrorDetail(BaseModel):
    """One thing that went wrong. Lists of these drive form-level errors."""

    code: str = Field(
        description="Stable machine-readable identifier, e.g. 'email_taken'.",
        examples=["validation_error"],
    )
    message: str = Field(description="Human-readable, safe to show to the user.")
    field: str | None = Field(
        default=None,
        description="Dotted path to the offending input, e.g. 'address.zip'.",
    )


class PaginationMeta(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)
    has_next: bool
    has_previous: bool

    @classmethod
    def create(cls, *, page: int, page_size: int, total_items: int) -> Self:
        total_pages = math.ceil(total_items / page_size) if page_size else 0
        return cls(
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1,
        )


class ResponseMetadata(BaseModel):
    """Envelope-level context: never part of the domain payload.

    Extra keys are allowed so a handler can attach anything one-off
    (``cache="hit"``, ``deprecation="2026-06-01"``) without a schema change.
    """

    model_config = ConfigDict(extra="allow")

    request_id: str | None = Field(
        default=None, description="Correlates the response with server logs."
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="When the response was produced (UTC).",
    )
    duration_ms: float | None = Field(
        default=None, description="Server-side handling time in milliseconds."
    )
    version: str = Field(default=API_VERSION, description="API contract version.")
    pagination: PaginationMeta | None = None


class APIResponse(BaseModel, Generic[T]):
    """Generic envelope. Annotate endpoints as ``APIResponse[UserOut]``.

    FastAPI resolves the generic when building the OpenAPI schema, so clients
    still get the concrete payload type — the envelope costs nothing in the
    generated types.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "success",
                "message": None,
                "data": {"id": "usr_1", "name": "Ada Lovelace"},
                "errors": None,
                "metadata": {
                    "request_id": "0f9c1c1e-6f2e-4d27-9f4e-9d0d0a5b7d11",
                    "timestamp": "2026-09-25T10:15:00Z",
                    "duration_ms": 12.4,
                    "version": API_VERSION,
                    "pagination": None,
                },
            }
        }
    )

    status: ResponseStatus = Field(description="Outcome of the request.")
    message: str | None = Field(
        default=None, description="Optional human-readable summary."
    )
    data: T | None = Field(
        default=None, description="The payload. Null on failure."
    )
    errors: list[ErrorDetail] | None = Field(
        default=None, description="Populated when status is 'error' or 'partial'."
    )
    metadata: ResponseMetadata = Field(default_factory=ResponseMetadata)

    # -- Constructors ------------------------------------------------- #
    # Handlers build envelopes through these rather than by hand, so the
    # status/errors/data combination can never drift out of agreement.

    @classmethod
    def ok(
        cls,
        data: T | None = None,
        *,
        message: str | None = None,
        metadata: ResponseMetadata | None = None,
        **extra_metadata: Any,
    ) -> Self:
        return cls(
            status=ResponseStatus.SUCCESS,
            message=message,
            data=data,
            metadata=_merge_metadata(metadata, extra_metadata),
        )

    @classmethod
    def paginated(
        cls,
        data: T,
        *,
        page: int,
        page_size: int,
        total_items: int,
        message: str | None = None,
        metadata: ResponseMetadata | None = None,
        **extra_metadata: Any,
    ) -> Self:
        merged = _merge_metadata(metadata, extra_metadata)
        merged.pagination = PaginationMeta.create(
            page=page, page_size=page_size, total_items=total_items
        )
        return cls(
            status=ResponseStatus.SUCCESS, message=message, data=data, metadata=merged
        )

    @classmethod
    def fail(
        cls,
        message: str,
        *,
        code: str = "error",
        errors: Sequence[ErrorDetail] | None = None,
        data: T | None = None,
        metadata: ResponseMetadata | None = None,
        **extra_metadata: Any,
    ) -> Self:
        details = list(errors) if errors else [ErrorDetail(code=code, message=message)]
        return cls(
            status=ResponseStatus.PARTIAL if data is not None else ResponseStatus.ERROR,
            message=message,
            data=data,
            errors=details,
            metadata=_merge_metadata(metadata, extra_metadata),
        )


def _merge_metadata(
    metadata: ResponseMetadata | None, extra: dict[str, Any]
) -> ResponseMetadata:
    base = metadata.model_copy(deep=True) if metadata else ResponseMetadata()
    for key, value in extra.items():
        setattr(base, key, value)
    return base


#: For endpoints that return nothing meaningful (deletes, 202-style accepts).
EmptyResponse = APIResponse[None]
