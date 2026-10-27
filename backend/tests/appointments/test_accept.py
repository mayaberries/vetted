import random
from typing import List, Callable

import pytest
from fastapi import FastAPI, status
from httpx import AsyncClient

from kalens import AppointmentsRepository
from app.api.scheduling import AppointmentPublic
from app.models.services.service import ServiceInDB
from app.models.auth.user import UserInDB

pytestmark = pytest.mark.asyncio


class TestAcceptAppointments:
    async def test_service_owner_can_accept_offer_succesfully(
            self,
            app: FastAPI,
            clinic_a_admin_client: AsyncClient,
            test_client_list: List[UserInDB],
            test_service_with_appointments: ServiceInDB
    ) -> None:
        appts_repo = AppointmentsRepository(app.state._db)
        appointments = await appts_repo.list_appointments_for_service(service=test_service_with_appointments)
        selected = random.choice(appointments)

        response = await clinic_a_admin_client.put(
            app.url_path_for(
                "appointments:confirm-appointment",
                service_id=test_service_with_appointments.id,
                appointment_id=selected.id,
            )
        )

        assert response.status_code == status.HTTP_200_OK

        accepted_offer = AppointmentPublic(**response.json())

        assert accepted_offer.status == "confirmed"
        assert accepted_offer.id == selected.id
        assert accepted_offer.service_id == test_service_with_appointments.id

    async def test_non_owner_forbidden_from_accepting_offer_for_service(
            self,
            app: FastAPI,
            create_authorized_client: Callable,
            user_client_one: UserInDB,
            test_client_list: List[UserInDB],
            test_service_with_appointments: ServiceInDB
    ) -> None:
        authorized_client = create_authorized_client(user=user_client_one)

        appts_repo = AppointmentsRepository(app.state._db)
        appointments = await appts_repo.list_appointments_for_service(service=test_service_with_appointments)
        selected = random.choice(appointments)

        response = await authorized_client.put(
            app.url_path_for(
                "appointments:confirm-appointment",
                service_id=test_service_with_appointments.id,
                appointment_id=selected.id,
            )
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
