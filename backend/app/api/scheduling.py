"""
Wires this app into kalens, the scheduling engine extracted from it.

kalens owns appointments, clinic availability and public booking; users,
services, clinics and pets stay here and are handed over once, below. See
kalens' docs/integration-contract.md for what each field must satisfy.

`appts` is the only handle the rest of the app should import. Its
dependencies in particular must be taken from it, never rebuilt: FastAPI
caches a dependency per request by callable identity, so a re-derived
`get_appointment_by_id_from_path` would load the same appointment twice.

Not mounted yet -- the host's own appointment routes are still the ones
serving traffic. Importing this module does nothing to the running app.
"""
from typing import Optional

import kalens
from kalens import AppointmentsIntegration, Settings, configure

from app.api.dependencies.auth import get_current_active_user
from app.api.dependencies.clinics import (
    check_clinic_modification_permissions,
    get_clinic_by_id_from_path,
)
from app.api.dependencies.pets import get_owner_profile_id_for_user
from app.api.dependencies.public_auth import get_clinic_from_public_key
from app.api.dependencies.services import (
    get_service_by_id_from_path,
    get_service_clinic_id,
    user_can_manage_service,
)
from app.api.dependencies.users import get_user_by_username_from_path
from app.core.config import (
    CLINIC_AVAILABILITY_READ_RATE_LIMIT_PER_CLINIC,
    CLINIC_AVAILABILITY_WRITE_RATE_LIMIT_PER_CLINIC,
    PUBLIC_RATE_LIMIT_PER_IP,
    PUBLIC_RATE_LIMIT_PER_KEY,
    REDIS_URL,
)
from app.db.repositories.clinic_owner_profiles import ClinicOwnerProfilesRepository
from app.db.repositories.pets import PetProfilesRepository
from app.db.repositories.services import ServicesRepository
from app.db.repositories.users import UsersRepository
from app.models.appointments.appointment import DEFAULT_APPOINTMENT_DURATION_MINUTES
from app.models.auth.user import UserPublic
from app.models.clinics.clinic_owner_profile import ClinicOwnerProfileRegistration
from app.models.profiles.pet_profile import PetProfilePublic, PublicPetInput
from app.models.services.service import ServicePublic


# kalens types these loosely because it can't import our models; these
# subclasses narrow them back so the emitted OpenAPI schema names the same
# types it does today.
# TODO(kalens): these replace the same-named classes in
# app/models/appointments/appointment.py once the host's routes are removed.
# Until then both exist, and only one may be mounted at a time or the schema
# gets two components called AppointmentPublic.
class AppointmentPublic(kalens.AppointmentPublic):
    user: Optional[UserPublic] = None
    pet: Optional[PetProfilePublic] = None
    service: Optional[ServicePublic] = None


class PublicAppointmentCreate(kalens.PublicAppointmentCreate):
    pet: PublicPetInput


appts = configure(AppointmentsIntegration(
    users_repository=UsersRepository,
    subject_repository=PetProfilesRepository,
    services_repository=ServicesRepository,
    owner_link_repository=ClinicOwnerProfilesRepository,
    get_current_active_user=get_current_active_user,
    get_service_by_id_from_path=get_service_by_id_from_path,
    get_user_by_username_from_path=get_user_by_username_from_path,
    get_clinic_by_id_from_path=get_clinic_by_id_from_path,
    check_clinic_modification_permissions=check_clinic_modification_permissions,
    get_clinic_from_public_key=get_clinic_from_public_key,
    user_can_manage_service=user_can_manage_service,
    get_service_clinic_id=get_service_clinic_id,
    get_owner_profile_id_for_user=get_owner_profile_id_for_user,
    appointment_public_model=AppointmentPublic,
    public_appointment_create_model=PublicAppointmentCreate,
    subject_public_model=PetProfilePublic,
    service_public_model=ServicePublic,
    owner_link_registration_model=ClinicOwnerProfileRegistration,
    # Read from the same env vars as app/core/limiter.py, so moving the routes
    # over later can't silently change a deployment's limits.
    settings=Settings(
        default_appointment_duration_minutes=DEFAULT_APPOINTMENT_DURATION_MINUTES,
        redis_url=REDIS_URL,
        public_rate_limit_per_key=PUBLIC_RATE_LIMIT_PER_KEY,
        public_rate_limit_per_ip=PUBLIC_RATE_LIMIT_PER_IP,
        clinic_availability_read_rate_limit_per_clinic=CLINIC_AVAILABILITY_READ_RATE_LIMIT_PER_CLINIC,
        clinic_availability_write_rate_limit_per_clinic=CLINIC_AVAILABILITY_WRITE_RATE_LIMIT_PER_CLINIC,
    ),
))
