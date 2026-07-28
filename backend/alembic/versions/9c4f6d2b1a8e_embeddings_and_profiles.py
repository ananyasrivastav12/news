# migration for article and user embedding storage
"""embeddings and profiles

Revision ID: 9c4f6d2b1a8e
Revises: 7a2b8c0d1e4f
Create Date: 2026-03-16 02:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c4f6d2b1a8e"
down_revision: Union[str, None] = "7a2b8c0d1e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch_op:
        batch_op.add_column(sa.Column("embedding", sa.JSON(), nullable=True))

    op.create_table(
        "user_embedding_profiles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "embedding",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_embedding_profiles")

    with op.batch_alter_table("articles") as batch_op:
        batch_op.drop_column("embedding")
