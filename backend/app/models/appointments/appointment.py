import datetime
from enum import Enum
from typing import Optional

from pydantic import EmailStr, Field, field_validator

from app.models.core import CoreModel, DateTimeModelMixin, IDModelMixin
from app.models.auth.user import UserPublic
from app.models.services.service import ServicePublic
from app.models.profiles.pet_profile import PetProfilePublic, PublicPetInput


class AppointmentStatus(str, Enum):
    requested = "requested"
    confirmed = "confirmed"
    declined = "declined"
    cancelled = "cancelled"
    completed = "completed"


def resolve_cancellation_status(current: Optional[AppointmentStatus]) -> AppointmentStatus:
    """
    What cancelling an appointment in `current` state turns it into.

    A booking that was never confirmed is *declined*, not cancelled -- that's
    the distinction the `declined` status exists for. Only clinic staff can
    reach this path with a requested appointment (a client withdraws instead);
    see check_appointment_cancel_permissions.

    Lives here rather than in the route so the permission check and the route
    can't drift on what counts as a cancellable state.

    `current` is Optional only because AppointmentBase types it that way; the
    column is NOT NULL with a default, so None can't come from the database.
    """
    if current == AppointmentStatus.requested:
        return AppointmentStatus.declined
    return AppointmentStatus.cancelled


class AppointmentBase(CoreModel):
    user_id: Optional[str] = None
    pet_id: Optional[str] = None
    service_id: Optional[str] = None
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None
    status: Optional[AppointmentStatus] = AppointmentStatus.requested
    # Set together when an appointment is cancelled or declined. `cancelled_by`
    # disambiguates the reason's author now that either side can cancel.
    cancellation_reason: Optional[str] = None
    cancelled_by: Optional[str] = None


class AppointmentCreate(CoreModel):
    user_id: str
    pet_id: str
    service_id: str
    start_time: datetime.datetime

    @field_validator("start_time")
    @classmethod
    def start_time_must_be_in_the_future(cls, value):
        return _validate_start_time_in_future(value)


def _validate_start_time_in_future(value: datetime.datetime) -> datetime.datetime:
    now = datetime.datetime.now(datetime.timezone.utc)
    if value <= now:
        raise ValueError("start_time must be in the future")
    return value


class AppointmentUpdate(CoreModel):
    status: AppointmentStatus


class AppointmentInDB(IDModelMixin, DateTimeModelMixin, AppointmentBase):
    user_id: str
    pet_id: str
    service_id: str
    start_time: datetime.datetime
    end_time: datetime.datetime


class AppointmentPublic(AppointmentInDB):
    user: Optional[UserPublic] = None
    pet: Optional[PetProfilePublic] = None
    service: Optional[ServicePublic] = None


DEFAULT_APPOINTMENT_DURATION_MINUTES = 30


class AppointmentCancelIn(CoreModel):
    """
    Body for the cancel route. Every field optional, so a bodyless PUT stays
    valid -- cancelling without giving a reason is a legitimate thing to do.
    """
    cancellation_reason: Optional[str] = Field(None, max_length=500)


class AppointmentRequestIn(CoreModel):
    pet_id: str
    start_time: datetime.datetime

    @field_validator("start_time")
    @classmethod
    def start_time_must_be_in_the_future(cls, value):
        return _validate_start_time_in_future(value)


class PublicAppointmentCreate(CoreModel):
    email: EmailStr
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    service_id: str
    pet: PublicPetInput
    start_time: datetime.datetime

    @field_validator("start_time")
    @classmethod
    def start_time_must_be_in_the_future(cls, value):
        return _validate_start_time_in_future(value)
