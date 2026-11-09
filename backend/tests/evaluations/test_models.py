from app.models.appointments.evaluation import EvaluationInDB, EvaluationPublic

# What EvaluationPublic exposes, in schema order, with whether it's required.
# Adding a field here is a decision to publish it.
EVALUATION_PUBLIC_FIELDS = [
    ("no_show", False), ("headline", False), ("comment", False),
    ("professionalism", False), ("completeness", False), ("efficiency", False),
    ("overall_rating", False), ("created_at", False), ("updated_at", False),
    ("appointment_id", True), ("cleaner_id", True), ("service_id", True),
    ("owner", False), ("cleaner", False), ("service", False),
]


def test_evaluation_public_exposes_exactly_its_fields() -> None:
    fields = [(name, f.is_required()) for name, f in EvaluationPublic.model_fields.items()]
    assert fields == EVALUATION_PUBLIC_FIELDS


def test_evaluation_public_does_not_inherit_in_db() -> None:
    # Inheriting *InDB publishes every column added to it later.
    assert not issubclass(EvaluationPublic, EvaluationInDB)
