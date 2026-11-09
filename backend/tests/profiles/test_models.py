import pytest

from app.models.profiles.owner_profile import OwnerProfileInDB, OwnerProfilePublic
from app.models.profiles.pet_profile import PetProfileInDB, PetProfilePublic

# What each *Public exposes, in schema order, with whether it's required.
# Adding a field here is a decision to publish it; the order and requiredness
# are what docs/openapi.json is derived from.
PUBLIC_FIELDS = {
    PetProfilePublic: [
        ("created_at", False), ("updated_at", False), ("name", True),
        ("species", False), ("breed", False), ("birth_date", False),
        ("notes", False), ("image", False), ("id", True),
        ("owner_profile_id", False),
    ],
    OwnerProfilePublic: [
        ("full_name", False), ("phone_number", False), ("bio", False),
        ("image", False), ("created_at", False), ("updated_at", False),
        ("id", True), ("user_id", False), ("username", False), ("email", False),
    ],
}


@pytest.mark.parametrize("public_model", PUBLIC_FIELDS, ids=lambda m: m.__name__)
def test_public_model_exposes_exactly_its_fields(public_model) -> None:
    fields = [(name, f.is_required()) for name, f in public_model.model_fields.items()]
    assert fields == PUBLIC_FIELDS[public_model]


@pytest.mark.parametrize(
    "public_model, in_db_model",
    ((PetProfilePublic, PetProfileInDB), (OwnerProfilePublic, OwnerProfileInDB)),
    ids=("pet", "owner"),
)
def test_public_model_does_not_inherit_in_db(public_model, in_db_model) -> None:
    # Inheriting *InDB publishes every column added to it later.
    assert not issubclass(public_model, in_db_model)
