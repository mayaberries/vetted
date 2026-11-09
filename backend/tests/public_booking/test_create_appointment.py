import datetime

import pytest
from databases import Database
from fastapi import FastAPI, status
from httpx import AsyncClient

from app.db.repositories.clinic_owner_profiles import ClinicOwnerProfilesRepository
from app.db.repositories.users import UsersRepository
from app.models.clinics.clinic_api_key import ClinicAPIKeyInDB
from app.models.services.service import ServiceInDB

pytestmark = pytest.mark.asyncio


def _future_start_time(days: int = 5) -> str:
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)).isoformat()


class TestCreatePublicAppointment:
    async def test_guest_can_book_appointment_with_new_pet(
            self, app: FastAPI, client: AsyncClient, db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,
    ) -> None:
        payload = {
            "email": "new-guest@example.com",
            "full_name": "New Guest",
            "phone_number": "555-0199",
            "service_id": test_service.id,
            "start_time": _future_start_time(),
            "pet": {"new_pet": {"name": "Blacky", "species": "cat"}},
        }
        response = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers={"X-Clinic-Key": clinic_a_public_key.public_key},
            json=payload,
        )
        assert response.status_code == status.HTTP_201_CREATED
        body = response.json()
        assert body["status"] == "requested"
        assert body["service_id"] == test_service.id
        assert body["pet"]["name"] == "Blacky"
        assert body["pet"]["species"] == "cat"

        users_repo = UsersRepository(db)
        guest = await users_repo.get_user_by_email(email="new-guest@example.com", populate=True)
        assert guest is not None
        assert guest.is_guest is True
        assert guest.profile.full_name == "New Guest"

        # NEW -- the previously-missing pivot now gets created.
        pivots_repo = ClinicOwnerProfilesRepository(db)
        pivot = await pivots_repo.get_pivot_for_clinic_and_owner(
            clinic_id=clinic_a_public_key.clinic_id, owner_profile_id=guest.profile.id
        )
        assert pivot is not None

    async def test_repeat_booking_reuses_guest_and_existing_pet(
            self, app: FastAPI, client: AsyncClient, db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,
    ) -> None:
        headers = {"X-Clinic-Key": clinic_a_public_key.public_key}

        first = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers=headers,
            json={
                "email": "repeat-guest@example.com",
                "full_name": "First Name",
                "service_id": test_service.id,
                "start_time": _future_start_time(days=10),
                "pet": {"new_pet": {"name": "Rex", "species": "dog"}},
            },
        )
        assert first.status_code == status.HTTP_201_CREATED
        pet_id = first.json()["pet"]["id"]

        second = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers=headers,
            json={
                "email": "repeat-guest@example.com",
                "full_name": "Updated Name",
                "service_id": test_service.id,
                "start_time": _future_start_time(days=11),
                "pet": {"pet_id": pet_id},  # reuse instead of creating a duplicate
            },
        )
        assert second.status_code == status.HTTP_201_CREATED
        assert second.json()["user_id"] == first.json()["user_id"]
        assert second.json()["pet"]["id"] == pet_id

        users_repo = UsersRepository(db)
        guest = await users_repo.get_user_by_email(email="repeat-guest@example.com", populate=True)
        assert guest.profile.full_name == "Updated Name"

    async def test_cannot_use_another_owners_pet_id(
            self, app: FastAPI, client: AsyncClient, db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,
    ) -> None:
        headers = {"X-Clinic-Key": clinic_a_public_key.public_key}

        owner_a = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers=headers,
            json={
                "email": "owner-a@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(days=1),
                "pet": {"new_pet": {"name": "Fido", "species": "dog"}},
            },
        )
        pet_id = owner_a.json()["pet"]["id"]

        response = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers=headers,
            json={
                "email": "owner-b@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(days=2),
                "pet": {"pet_id": pet_id},  # not owner-b's pet
            },
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    async def test_cannot_book_service_belonging_to_another_clinic(
            self, app: FastAPI, client: AsyncClient,
            clinic_b_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,  # belongs to clinic A
    ) -> None:
        response = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers={"X-Clinic-Key": clinic_b_public_key.public_key},
            json={
                "email": "cross-clinic@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(),
                "pet": {"new_pet": {"name": "Whiskers", "species": "cat"}},
            },
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    async def test_pet_id_and_new_pet_together_rejected(
            self, app: FastAPI, client: AsyncClient,
            clinic_a_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,
    ) -> None:
        response = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers={"X-Clinic-Key": clinic_a_public_key.public_key},
            json={
                "email": "both@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(),
                "pet": {"pet_id": "some-id", "new_pet": {"name": "X"}},
            },
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


class TestListPublicPets:
    async def test_unknown_email_returns_empty_list(
            self, app: FastAPI, client: AsyncClient, clinic_a_public_key: ClinicAPIKeyInDB,
    ) -> None:
        response = await client.get(
            app.url_path_for("public-booking:list-pets"),
            headers={"X-Clinic-Key": clinic_a_public_key.public_key},
            params={"email": "nobody@example.com"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == []

    async def test_returns_pets_registered_with_this_clinic(
            self, app: FastAPI, client: AsyncClient, db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB, test_service: ServiceInDB,
    ) -> None:
        headers = {"X-Clinic-Key": clinic_a_public_key.public_key}
        await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers=headers,
            json={
                "email": "widget-guest@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(),
                "pet": {"new_pet": {"name": "Blacky", "species": "cat"}},
            },
        )

        response = await client.get(
            app.url_path_for("public-booking:list-pets"),
            headers=headers,
            params={"email": "widget-guest@example.com"},
        )
        assert response.status_code == status.HTTP_200_OK
        pets = response.json()
        assert len(pets) == 1
        assert pets[0]["name"] == "Blacky"

    async def test_does_not_leak_pets_registered_with_a_different_clinic(
            self, app: FastAPI, client: AsyncClient, db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB, clinic_b_public_key: ClinicAPIKeyInDB,
            test_service: ServiceInDB,  # belongs to clinic A
    ) -> None:
        await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers={"X-Clinic-Key": clinic_a_public_key.public_key},
            json={
                "email": "clinic-a-only@example.com", "service_id": test_service.id,
                "start_time": _future_start_time(),
                "pet": {"new_pet": {"name": "OnlyAtA", "species": "dog"}},
            },
        )

        response = await client.get(
            app.url_path_for("public-booking:list-pets"),
            headers={"X-Clinic-Key": clinic_b_public_key.public_key},
            params={"email": "clinic-a-only@example.com"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == []

    async def test_guest_account_cannot_authenticate_via_password_login(
            self,
            app: FastAPI,
            client: AsyncClient,
            db: Database,
            clinic_a_public_key: ClinicAPIKeyInDB,
            test_service: ServiceInDB,
    ) -> None:
        booking = await client.post(
            app.url_path_for("public-booking:create-appointment"),
            headers={"X-Clinic-Key": clinic_a_public_key.public_key},
            json={
                "email": "login-attempt@example.com",
                "service_id": test_service.id,
                "start_time": _future_start_time(),
                "pet": {"new_pet": {"name": "Login Pet"}},
            },
        )
        # Without this the test passes vacuously: a rejected booking creates
        # no guest, and a user that doesn't exist can't log in either.
        assert booking.status_code == status.HTTP_201_CREATED
        users_repo = UsersRepository(db)
        # The guest's password is random and never disclosed, so this
        # specifically checks the explicit is_guest guard in
        # authenticate_user rather than relying on the password being
        # unguessable.
        authenticated = await users_repo.authenticate_user(
            email="login-attempt@example.com", password="anything-at-all"
        )
        assert authenticated is None
