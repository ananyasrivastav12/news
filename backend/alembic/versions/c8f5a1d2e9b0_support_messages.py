# migration for profile support messages
"""support messages

Revision ID: c8f5a1d2e9b0
Revises: a4d8e2b9c6f0
Create Date: 2026-07-28 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c8f5a1d2e9b0"
down_revision: Union[str, None] = "a4d8e2b9c6f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "status", sa.String(length=32), nullable=False, server_default="open"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_support_messages_id"), "support_messages", ["id"])
    op.create_index(
        op.f("ix_support_messages_user_id"), "support_messages", ["user_id"]
    )
    op.create_index(op.f("ix_support_messages_status"), "support_messages", ["status"])
    op.create_index(
        op.f("ix_support_messages_created_at"), "support_messages", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_support_messages_created_at"), table_name="support_messages")
    op.drop_index(op.f("ix_support_messages_status"), table_name="support_messages")
    op.drop_index(op.f("ix_support_messages_user_id"), table_name="support_messages")
    op.drop_index(op.f("ix_support_messages_id"), table_name="support_messages")
    op.drop_table("support_messages")
