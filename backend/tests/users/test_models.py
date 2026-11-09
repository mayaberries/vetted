import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.auth.user import UserCreate, UserInDB, UserUpdate
from app.models.core import DateTimeModelMixin

BACKEND_DIR = Path(__file__).resolve().parents[2]

# A real bcrypt hash: what UserInDB.password holds once a user is stored.
BCRYPT_HASH = "$2b$12$KIXQJ1b6b4Gm0yZKc1vF9eQZ2r9Yy6m8lZpJr1m4kY0xQwWvXyZ1a"


def _user_create(username: str) -> UserCreate:
    return UserCreate(email="someone@example.io", password="long-enough", username=username)


INVALID_USERNAMES = pytest.mark.parametrize(
    "username",
    ("ab", "a!", "shakira@#$%^<>"),
    ids=("too-short", "bang", "symbols"),
)
VALID_USERNAMES = pytest.mark.parametrize(
    "username",
    ("abc", "a-b_1"),
    ids=("exactly-three", "every-allowed-kind"),
)


class TestUsername:
    @INVALID_USERNAMES
    def test_create_rejects_invalid_username(self, username: str) -> None:
        with pytest.raises(ValidationError):
            _user_create(username)

    @INVALID_USERNAMES
    def test_update_rejects_invalid_username(self, username: str) -> None:
        with pytest.raises(ValidationError):
            UserUpdate(username=username)

    @VALID_USERNAMES
    def test_create_accepts_valid_username(self, username: str) -> None:
        assert _user_create(username).username == username

    @VALID_USERNAMES
    def test_update_accepts_valid_username(self, username: str) -> None:
        assert UserUpdate(username=username).username == username

    def test_update_accepts_no_username(self) -> None:
        assert UserUpdate(username=None).username is None

    def test_validation_survives_optimised_python(self) -> None:
        # pytest only rewrites asserts in test modules, so an `assert` in app
        # code is invisible to it: the regression only shows under `-O`.
        script = (
            "from pydantic import ValidationError\n"
            "from app.models.auth.user import UserCreate\n"
            "try:\n"
            "    UserCreate(email='someone@example.io', password='long-enough', username='a!')\n"
            "except ValidationError:\n"
            "    raise SystemExit(0)\n"
            "raise SystemExit('username a! was accepted')\n"
        )
        result = subprocess.run(
            [sys.executable, "-O", "-c", script],
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr


class TestPassword:
    def test_create_rejects_short_password(self) -> None:
        with pytest.raises(ValidationError):
            UserCreate(email="someone@example.io", password="sixchr", username="someone")

    def test_in_db_holds_a_bcrypt_hash(self) -> None:
        user = UserInDB(id="1", email="someone@example.io", username="someone",
                        password=BCRYPT_HASH, salt="salt")
        assert user.password == BCRYPT_HASH


class TestTimestamps:
    def test_missing_timestamps_default_to_utc_now(self) -> None:
        before = datetime.now(timezone.utc)
        model = DateTimeModelMixin(created_at=None, updated_at=None)
        after = datetime.now(timezone.utc)

        for value in (model.created_at, model.updated_at):
            assert value.tzinfo is not None
            assert value.utcoffset() == timedelta(0)
            assert before <= value <= after

    def test_given_timestamp_is_kept(self) -> None:
        given = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        assert DateTimeModelMixin(created_at=given).created_at == given
