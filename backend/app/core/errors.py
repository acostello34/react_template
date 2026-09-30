"""Domain exceptions and the handlers that turn every failure into an envelope.

Anything that escapes a route — a raised ``AppError``, a plain
``HTTPException``, a validation failure, or a bug — leaves the server as an
``APIResponse`` with ``status: "error"``. The frontend's axios layer therefore
never has to special-case FastAPI's default ``{"detail": ...}`` shape.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.middleware import elapsed_ms, request_id
from app.schemas.response import APIResponse, ErrorDetail, ResponseMetadata

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for expected, reportable failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        errors: Sequence[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.errors = list(errors) if errors else [ErrorDetail(code=self.code, message=message)]


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class UnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


def build_metadata(request: Request, **extra: Any) -> ResponseMetadata:
    return ResponseMetadata(
        request_id=request_id(request), duration_ms=elapsed_ms(request), **extra
    )


def envelope_response(
    request: Request,
    *,
    status_code: int,
    message: str,
    errors: Sequence[ErrorDetail],
) -> JSONResponse:
    payload = APIResponse[None].fail(
        message, errors=errors, metadata=build_metadata(request)
    )
    return JSONResponse(
        status_code=status_code,
        # mode="json" so datetimes/enums are serialized, not left as objects.
        content=payload.model_dump(mode="json"),
    )


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return envelope_response(
        request, status_code=exc.status_code, message=exc.message, errors=exc.errors
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return envelope_response(
        request,
        status_code=exc.status_code,
        message=message,
        errors=[ErrorDetail(code=f"http_{exc.status_code}", message=message)],
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = [
        ErrorDetail(
            code=str(error.get("type", "validation_error")),
            message=str(error.get("msg", "Invalid value")),
            # Drop the leading "body"/"query"/"path" segment so the path lines
            # up with the field names the client's form uses.
            field=".".join(str(part) for part in error.get("loc", ())[1:]) or None,
        )
        for error in exc.errors()
    ]
    return envelope_response(
        request,
        # Literal 422: Starlette renamed the constant to
        # HTTP_422_UNPROCESSABLE_CONTENT and deprecated the old spelling.
        status_code=422,
        message="Some of the submitted values are invalid.",
        errors=errors,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log the detail, return none of it: internals do not belong in a response.
    logger.exception(
        "Unhandled error on %s %s (request_id=%s)",
        request.method,
        request.url.path,
        request_id(request),
    )
    return envelope_response(
        request,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        message="Something went wrong on our end.",
        errors=[ErrorDetail(code="internal_error", message="Something went wrong on our end.")],
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
