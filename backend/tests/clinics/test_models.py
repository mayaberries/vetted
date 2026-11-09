from app.models.clinics.clinic_owner_profile import (
    ClinicOwnerProfileInDB,
    ClinicOwnerProfilePublic,
)

# What ClinicOwnerProfilePublic exposes, in schema order, with whether it's
# required. Adding a field here is a decision to publish it.
CLINIC_OWNER_PROFILE_PUBLIC_FIELDS = [
    ("notes", False), ("status", False), ("referred_by", False),
    ("created_at", False), ("updated_at", False), ("id", True),
    ("clinic_id", True), ("owner_profile_id", False), ("first_seen_at", True),
]


def test_clinic_owner_profile_public_exposes_exactly_its_fields() -> None:
    fields = [(name, f.is_required())
              for name, f in ClinicOwnerProfilePublic.model_fields.items()]
    assert fields == CLINIC_OWNER_PROFILE_PUBLIC_FIELDS


def test_clinic_owner_profile_public_does_not_inherit_in_db() -> None:
    # Inheriting *InDB publishes every column added to it later.
    assert not issubclass(ClinicOwnerProfilePublic, ClinicOwnerProfileInDB)
