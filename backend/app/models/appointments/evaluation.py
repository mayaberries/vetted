from datetime import datetime
from typing import Optional, Union
from pydantic import conint, confloat, field_validator

from app.models.core import DateTimeModelMixin, CoreModel, fill_missing_timestamp
from app.models.auth.user import UserPublic
from app.models.services.service import ServicePublic


class EvaluationBase(CoreModel):
    no_show: bool = False
    headline: Optional[str] = None
    comment: Optional[str] = None
    professionalism: Optional[conint(ge=0, le=5)] = None
    completeness: Optional[conint(ge=0, le=5)] = None
    efficiency: Optional[conint(ge=0, le=5)] = None
    overall_rating: Optional[conint(ge=0, le=5)] = None


class EvaluationCreate(EvaluationBase):
    overall_rating: conint(ge=1, le=5)


class EvaluationUpdate(EvaluationBase):
    pass


class EvaluationInDB(DateTimeModelMixin, EvaluationBase):
    appointment_id: str
    cleaner_id: str
    service_id: str


class EvaluationAggregate(CoreModel):
    avg_professionalism: confloat(ge=0, le=5)
    avg_completeness: confloat(ge=0, le=5)
    avg_efficiency: confloat(ge=0, le=5)
    avg_overall_rating: confloat(ge=0, le=5)
    max_overall_rating: conint(ge=0, le=5)
    min_overall_rating: conint(ge=0, le=5)
    one_stars: conint(ge=0)
    two_stars: conint(ge=0)
    three_stars: conint(ge=0)
    four_stars: conint(ge=0)
    five_stars: conint(ge=0)
    total_evaluations: conint(ge=0)
    total_no_show: conint(ge=0)


class EvaluationPublic(CoreModel):
    # An allow-list, not a subclass of EvaluationInDB: a new column is only
    # published by adding it here. Field order is the OpenAPI schema's, which
    # is why the timestamps are declared here rather than by the mixin.
    no_show: bool = False
    headline: Optional[str] = None
    comment: Optional[str] = None
    professionalism: Optional[conint(ge=0, le=5)] = None
    completeness: Optional[conint(ge=0, le=5)] = None
    efficiency: Optional[conint(ge=0, le=5)] = None
    overall_rating: Optional[conint(ge=0, le=5)] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    appointment_id: str
    cleaner_id: str
    service_id: str
    owner: Optional[Union[str, UserPublic]] = None
    cleaner: Optional[UserPublic] = None
    service: Optional[ServicePublic] = None

    default_datetime = field_validator("created_at", "updated_at", mode="before")(fill_missing_timestamp)
