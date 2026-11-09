"""add cancellation reason to appointments

Records *why* an appointment was cancelled, and *who* cancelled it.

Both nullable: existing rows have no reason, and a client is still allowed to
cancel silently. `cancelled_by` matters because cancelling is no longer
single-sided -- clinic staff can cancel too (see
check_appointment_cancel_permissions), so a reason with no author would be
ambiguous about which side wrote it.

ON DELETE SET NULL, deliberately unlike the neighbouring FKs on this table
(user_id CASCADE, pet_id RESTRICT): deleting a staff account must not delete
the clinic's appointment history, nor be blocked by it. Losing just the
attribution is the right degradation.

Revision ID: 38488164cd7a
Revises: 02702ac5c6e7
Create Date: 2026-08-22 19:31:08.940856
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '38488164cd7a'
down_revision = '02702ac5c6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("cancellation_reason", sa.Text, nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column(
            "cancelled_by",
            sa.CHAR(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("appointments", "cancelled_by")
    op.drop_column("appointments", "cancellation_reason")
