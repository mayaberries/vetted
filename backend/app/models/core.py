from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict, field_validator


class CoreModel(BaseModel):
    """
    Any common logic to be shared by all models goes here.
    """
    pass


class InputModel(CoreModel):
    """
    Base for new request bodies (*Create, *Update, *Request). Unknown fields
    are a 422 instead of being silently dropped, so a typo'd or unsupported
    field can't look like it was accepted. Existing input models still extend
    CoreModel; see .claude/skills/create-model/.
    """
    model_config = ConfigDict(extra="forbid")


def fill_missing_timestamp(value: datetime | None) -> datetime:
    return value or datetime.now(timezone.utc)


class DateTimeModelMixin(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def default_datetime(cls, value: datetime) -> datetime:
        return fill_missing_timestamp(value)


class IDModelMixin(BaseModel):
    id: str