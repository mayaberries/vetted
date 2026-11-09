"""
Domain errors. New services and repositories raise these instead of
`HTTPException`, so business rules don't know they're behind HTTP;
`app/api/errors.py` maps each one to its status code in one place.

Existing code still raises `HTTPException` -- it moves over as it's touched,
not in passing (see .claude/skills/create-repository/).

Subclass the closest one per case (`class SlugTakenError(ConflictError)`) so
callers and tests can catch it by name. `detail` is the user-facing message.
Mirrors sinapsis' app/shared/errors.py; keep the two in step.
"""
from typing import Dict, Optional


class DomainError(Exception):
    def __init__(self, detail: str, *, headers: Optional[Dict[str, str]] = None) -> None:
        super().__init__(detail)
        self.detail = detail
        # Response headers the error needs, e.g. `WWW-Authenticate` on a 401.
        self.headers = headers


class NotAuthenticatedError(DomainError):
    pass


class NotFoundError(DomainError):
    pass


class PermissionDeniedError(DomainError):
    pass


class ConflictError(DomainError):
    pass


class ServiceUnavailableError(DomainError):
    """Something the request can't do without (the database) is unreachable."""
