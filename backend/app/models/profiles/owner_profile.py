from datetime import datetime
from typing import Optional
from pydantic import EmailStr, HttpUrl, field_validator

from app.models.core import DateTimeModelMixin, IDModelMixin, CoreModel, fill_missing_timestamp


class OwnerProfileBase(CoreModel):
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    bio: Optional[str] = None
    image: Optional[HttpUrl] = None


class OwnerProfileCreate(OwnerProfileBase):
    user_id: Optional[str] = None


class OwnerProfileUpdate(OwnerProfileBase):
    pass


class OwnerProfileInDB(IDModelMixin, DateTimeModelMixin, OwnerProfileBase):
    user_id: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None


class OwnerProfilePublic(CoreModel):
    # An allow-list, not a subclass of OwnerProfileInDB: a new column is only
    # published by adding it here. Field order is the OpenAPI schema's, which
    # is why the timestamps are declared here rather than by the mixin.
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    bio: Optional[str] = None
    image: Optional[HttpUrl] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    id: str
    user_id: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None

    default_datetime = field_validator("created_at", "updated_at", mode="before")(fill_missing_timestamp)
