"""Example wiring. Shows the envelope in use on real routes."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.api.products import router as products_router
from app.core.errors import (
    ConflictError,
    NotFoundError,
    build_metadata,
    register_exception_handlers,
)
from app.core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from app.schemas.response import APIResponse, EmptyResponse

app = FastAPI(title="Example API", version="1.0")

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this the browser hides the header and the client loses the id.
    expose_headers=[REQUEST_ID_HEADER],
)

register_exception_handlers(app)
app.include_router(products_router)


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserOut(UserIn):
    id: str


_users: dict[str, UserOut] = {}


@app.get("/api/v1/users", response_model=APIResponse[list[UserOut]])
async def list_users(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> APIResponse[list[UserOut]]:
    rows = list(_users.values())
    start = (page - 1) * page_size
    return APIResponse[list[UserOut]].paginated(
        rows[start : start + page_size],
        page=page,
        page_size=page_size,
        total_items=len(rows),
        metadata=build_metadata(request),
    )


@app.post(
    "/api/v1/users",
    response_model=APIResponse[UserOut],
    status_code=status.HTTP_201_CREATED,
)
async def create_user(request: Request, body: UserIn) -> APIResponse[UserOut]:
    if any(user.email == body.email for user in _users.values()):
        # Raising is enough — the handler shapes the envelope, and `field`
        # lets the form highlight the offending input.
        raise ConflictError("That email address is already registered.", code="email_taken")

    user = UserOut(id=f"usr_{uuid.uuid4().hex[:8]}", **body.model_dump())
    _users[user.id] = user
    return APIResponse[UserOut].ok(
        user, message="User created.", metadata=build_metadata(request)
    )


@app.get("/api/v1/users/{user_id}", response_model=APIResponse[UserOut])
async def get_user(request: Request, user_id: str) -> APIResponse[UserOut]:
    user = _users.get(user_id)
    if user is None:
        raise NotFoundError(f"No user with id {user_id!r}.")
    return APIResponse[UserOut].ok(user, metadata=build_metadata(request))


@app.delete("/api/v1/users/{user_id}", response_model=EmptyResponse)
async def delete_user(request: Request, user_id: str) -> EmptyResponse:
    if _users.pop(user_id, None) is None:
        raise NotFoundError(f"No user with id {user_id!r}.")
    return EmptyResponse.ok(message="User deleted.", metadata=build_metadata(request))
