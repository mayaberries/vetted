import pytest
from fastapi import FastAPI, status

from httpx import AsyncClient

from app.api.scheduling import AppointmentPublic
from app.models.services.service import ServiceInDB
from app.models.auth.user import UserInDB
from tests._helpers.get_appointment import get_appointment_for

pytestmark = pytest.mark.asyncio


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
