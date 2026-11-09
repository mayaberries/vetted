"""
Domain errors -> HTTP (app/api/errors.py): the status each one maps to, the
body and headers the handler sends, and the OpenAPI `responses=` built from
the same table.

Self-contained on purpose: a bare app with only the handler registered and
no database, so these run without the dockerized db (and without the
conftest's smoke check: `pytest --noconftest tests/errors`).
"""
import pytest
import pytest_asyncio
from fastapi import FastAPI, status
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api.errors import error_responses, register_error_handlers, status_code_for
from app.core.errors import (
    ConflictError,
    DomainError,
    NotAuthenticatedError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.models.core import CoreModel, InputModel


class SlugTakenError(ConflictError):
    """A domain-specific subclass, mapped through its parent."""


CASES = [
    (NotAuthenticatedError, status.HTTP_401_UNAUTHORIZED),
    (PermissionDeniedError, status.HTTP_403_FORBIDDEN),
    (NotFoundError, status.HTTP_404_NOT_FOUND),
    (ConflictError, status.HTTP_409_CONFLICT),
    (SlugTakenError, status.HTTP_409_CONFLICT),
    (ServiceUnavailableError, status.HTTP_503_SERVICE_UNAVAILABLE),
    (DomainError, status.HTTP_400_BAD_REQUEST),
]
CASE_IDS = [error.__name__ for error, _ in CASES]


def _app_raising(error: DomainError) -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/raise", responses=error_responses(type(error)))
    async def raise_it() -> None:
        raise error

    return app


@pytest_asyncio.fixture
async def make_client():
    clients = []

    def make(app: FastAPI) -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
        clients.append(client)
        return client

    yield make
    for client in clients:
        await client.aclose()


@pytest.mark.parametrize("error, code", CASES, ids=CASE_IDS)
def test_each_error_maps_to_its_status(error, code) -> None:
    assert status_code_for(error) == code


@pytest.mark.asyncio
@pytest.mark.parametrize("error, code", CASES, ids=CASE_IDS)
async def test_handler_sends_the_status_and_detail(error, code, make_client) -> None:
    client = make_client(_app_raising(error("Something specific.")))

    response = await client.get("/raise")

    assert response.status_code == code
    # The same shape HTTPException gives, so old and new routes look alike.
    assert response.json() == {"detail": "Something specific."}


@pytest.mark.asyncio
async def test_handler_passes_the_errors_headers(make_client) -> None:
    error = NotAuthenticatedError("No authenticated user.", headers={"WWW-Authenticate": "Bearer"})
    client = make_client(_app_raising(error))

    response = await client.get("/raise")

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.headers["www-authenticate"] == "Bearer"


def test_error_responses_lists_each_status_once_in_order() -> None:
    responses = error_responses(SlugTakenError, NotFoundError, ConflictError, PermissionDeniedError)

    assert list(responses) == [403, 404, 409]
    assert all(entry["model"].__name__ == "ErrorResponse" for entry in responses.values())


def test_declared_errors_appear_in_the_openapi_schema() -> None:
    operation = _app_raising(NotFoundError("Missing.")).openapi()["paths"]["/raise"]["get"]

    schema_ref = operation["responses"]["404"]["content"]["application/json"]["schema"]["$ref"]
    assert schema_ref.endswith("/ErrorResponse")


class InvoiceCreate(InputModel):
    number: str


class InvoicePublic(CoreModel):
    number: str


def test_input_models_reject_unknown_fields() -> None:
    with pytest.raises(ValidationError) as excinfo:
        InvoiceCreate.model_validate({"number": "A-1", "nmuber": "typo"})

    assert excinfo.value.errors()[0]["type"] == "extra_forbidden"


def test_core_models_still_ignore_unknown_fields() -> None:
    # Rows and responses may carry columns a model doesn't list.
    assert InvoicePublic.model_validate({"number": "A-1", "internal": "x"}).number == "A-1"
