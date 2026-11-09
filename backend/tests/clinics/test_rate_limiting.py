import pytest
from fastapi import FastAPI, status
from httpx import AsyncClient

from app.core.config import CLINIC_AVAILABILITY_READ_RATE_LIMIT_PER_CLINIC
from app.models.auth.user import UserInDB

pytestmark = pytest.mark.asyncio


class TestClinicAvailabilityRateLimit:
    # Proves app/api/scheduling.py hands kalens our configured read limit.
    # The limiter's own behaviour (per-clinic buckets, read/write tiers) is
    # kalens' to test.
    async def test_per_clinic_limit_returns_429_once_exceeded(
            self, app: FastAPI, client: AsyncClient, user_clinic_a_admin: UserInDB
    ) -> None:
        url = app.url_path_for("clinic-availability:get-availability", clinic_id=user_clinic_a_admin.clinic_id)

        for _ in range(CLINIC_AVAILABILITY_READ_RATE_LIMIT_PER_CLINIC):
            response = await client.get(url)
            assert response.status_code == status.HTTP_200_OK

        blocked = await client.get(url)
        assert blocked.status_code == status.HTTP_429_TOO_MANY_REQUESTS
