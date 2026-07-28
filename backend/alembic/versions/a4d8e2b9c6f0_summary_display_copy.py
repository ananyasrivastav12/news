# migration for card headline and why-it-matters fields
"""summary display copy

Revision ID: a4d8e2b9c6f0
Revises: f2a7c9d4e6b1
Create Date: 2026-07-27 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a4d8e2b9c6f0"
down_revision: Union[str, None] = "f2a7c9d4e6b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("summaries") as batch_op:
        batch_op.add_column(sa.Column("display_headline", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("why_it_matters", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("summaries") as batch_op:
        batch_op.drop_column("why_it_matters")
        batch_op.drop_column("display_headline")
