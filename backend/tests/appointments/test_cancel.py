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
    async def test_user_can_cancel_offer_after_it_has_been_accepted(
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

        cancelled_offer = AppointmentPublic(**response.json())

        assert cancelled_offer.status == "cancelled"
        assert cancelled_offer.user_id == user_client_one.id
        assert cancelled_offer.service_id == test_service_with_accepted_appointment.id

    async def test_only_accepted_appointments_can_be_cancelled(
            self,
            app: FastAPI,
            create_authorized_client: Callable,
            user_client_two: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        accepted_user_client = create_authorized_client(user=user_client_two)

        appts_repo = AppointmentsRepository(app.state._db)
        appointments = await appts_repo.list_appointments_for_service(service=test_service_with_accepted_appointment)
        own_appointment = [a for a in appointments if a.user_id == user_client_two.id][0]

        response = await accepted_user_client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=own_appointment.id,
            )
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

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

    async def test_staff_cancelling_a_requested_appointment_declines_it(
            self,
            app: FastAPI,
            clinic_a_admin_client: AsyncClient,
            user_client_two: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        # user_client_two's appointment is still `requested` -- a booking that
        # was never confirmed is declined, not cancelled.
        appointment = await get_appointment_for(
            app, test_service_with_accepted_appointment, user_client_two
        )

        response = await clinic_a_admin_client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=appointment.id,
            )
        )

        assert response.status_code == status.HTTP_200_OK
        assert AppointmentPublic(**response.json()).status == "declined"

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


class TestCancellationReason:
    async def test_reason_is_persisted_and_returned(
            self,
            app: FastAPI,
            clinic_a_admin_client: AsyncClient,
            user_clinic_a_admin: UserInDB,
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
            ),
            json={"cancellation_reason": "Clinic closed that day"},
        )

        assert response.status_code == status.HTTP_200_OK
        cancelled = AppointmentPublic(**response.json())
        assert cancelled.cancellation_reason == "Clinic closed that day"
        assert cancelled.cancelled_by == user_clinic_a_admin.id

        # And it survives a round trip through the database, rather than only
        # being echoed back by the route.
        appts_repo = AppointmentsRepository(app.state._db)
        stored = await appts_repo.get_appointment_by_id(id=appointment.id)
        assert stored.cancellation_reason == "Clinic closed that day"
        assert stored.cancelled_by == user_clinic_a_admin.id

    async def test_cancelling_without_a_body_is_still_allowed(
            self,
            app: FastAPI,
            create_authorized_client: Callable,
            user_client_one: UserInDB,
            test_service_with_accepted_appointment: ServiceInDB
    ) -> None:
        # Cancelling without explaining yourself is legitimate, and every
        # pre-existing caller sends no body at all.
        client = create_authorized_client(user=user_client_one)
        appointment = await get_appointment_for(
            app, test_service_with_accepted_appointment, user_client_one
        )

        response = await client.put(
            app.url_path_for(
                "appointments:cancel-appointment",
                service_id=test_service_with_accepted_appointment.id,
                appointment_id=appointment.id,
            )
        )

        assert response.status_code == status.HTTP_200_OK
        cancelled = AppointmentPublic(**response.json())
        assert cancelled.status == "cancelled"
        assert cancelled.cancellation_reason is None
        assert cancelled.cancelled_by == user_client_one.id

    async def test_reason_longer_than_the_limit_is_rejected(
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
            ),
            json={"cancellation_reason": "x" * 501},
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
