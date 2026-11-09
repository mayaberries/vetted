from typing import Any, Dict, List, Tuple, Type, Union

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.core.errors import (
    ConflictError,
    DomainError,
    NotAuthenticatedError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.models.core import CoreModel

# Most specific first: the first class the error is an instance of wins. A
# subclass that needs a different code goes above its parent.
STATUS_CODES: List[Tuple[Type[DomainError], int]] = [
    (NotAuthenticatedError, status.HTTP_401_UNAUTHORIZED),
    (NotFoundError, status.HTTP_404_NOT_FOUND),
    (PermissionDeniedError, status.HTTP_403_FORBIDDEN),
    (ConflictError, status.HTTP_409_CONFLICT),
    (ServiceUnavailableError, status.HTTP_503_SERVICE_UNAVAILABLE),
    (DomainError, status.HTTP_400_BAD_REQUEST),
]


class ErrorResponse(CoreModel):
    """The body of every error response a domain error produces -- the same
    `{"detail": ...}` shape HTTPException already gives, so clients see no
    difference between old and new routes."""
    detail: str


def status_code_for(error: Type[DomainError]) -> int:
    return next(code for parent, code in STATUS_CODES if issubclass(error, parent))


def error_responses(*errors: Type[DomainError]) -> Dict[Union[int, str], Dict[str, Any]]:
    """
    `responses=` for a route that can raise these, so docs/openapi.json (and
    the admin app's types) list each error status. Built from STATUS_CODES,
    the same table the handler uses, so the two can't disagree.

        @router.get(..., responses=error_responses(NotFoundError, PermissionDeniedError))
    """
    codes = sorted({status_code_for(error) for error in errors})
    return {code: {"model": ErrorResponse} for code in codes}


async def _handle_domain_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DomainError)
    return JSONResponse(
        status_code=status_code_for(type(exc)),
        content=ErrorResponse(detail=exc.detail).model_dump(),
        headers=exc.headers,
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_domain_error)
