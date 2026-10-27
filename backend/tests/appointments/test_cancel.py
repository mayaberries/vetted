from typing import Callable

import pytest
from fastapi import FastAPI, status

from httpx import AsyncClient

from kalens import AppointmentsRepository
from app.api.scheduling import AppointmentPublic
from app.models.services.service import ServiceInDB
from app.models.auth.user import UserInDB
from tests._helpers.get_appointment import get_appointment_for

pytestmark = pytest.mark.asyncio


class TestCancelAppointments:
    # TODO(kalens#1): engine behaviour kept here only because kalens'
    # suite doesn't cover it yet -- drop once a kalens release does.
    async def test_canceling_offer_does_not_affect_others(
            self,
            app: FastAPI,
            create_authorized_client: Callable,
            user_client_one: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        accepted_user_client = create_authorized_client(user=user_client_one)

        appts_repo = AppointmentsRepository(app.state._db)
        appointments = await appts_repo.list_appointments_for_service(service=test_service_with_accepted_appointment)
        own_appointment = [a for a in appointments if a.user_id == user_client_one.id][0]

        response = await accepted_user_client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=own_appointment.id,
            )
        )

        assert response.status_code == status.HTTP_200_OK

        appointments = await appts_repo.list_appointments_for_service(
            service=test_service_with_accepted_appointment
        )

        for appt in appointments:
            if appt.user_id == user_client_one.id:
                assert appt.status == "cancelled"
            else:
                assert appt.status == "requested"


class TestStaffCancelAppointments:
    """
    Clinic staff cancelling, which used to 403 -- cancel was client-only, so the
    admin dashboard had no way to call it at all.
    """

    async def test_clinic_staff_can_cancel_a_confirmed_appointment(
            self,
            app: FastAPI,
            clinic_a_admin_client: AsyncClient,
            user_client_one: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        appointment = await get_appointment_for(
            app, test_service_with_accepted_appointment, user_client_one
        )

        response = await clinic_a_admin_client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=appointment.id,
            )
        )

        assert response.status_code == status.HTTP_200_OK
        assert AppointmentPublic(**response.json()).status == "cancelled"

    async def test_staff_of_another_clinic_cannot_cancel(
            self,
            app: FastAPI,
            clinic_b_admin_client: AsyncClient,
            user_client_one: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        appointment = await get_appointment_for(
            app, test_service_with_accepted_appointment, user_client_one
        )

        response = await clinic_b_admin_client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=appointment.id,
            )
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
