# migration for article market/country tracking
"""article country

Revision ID: d3e7a9c2b5f1
Revises: 9c4f6d2b1a8e
Create Date: 2026-06-08 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d3e7a9c2b5f1"
down_revision: Union[str, None] = "9c4f6d2b1a8e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch_op:
        batch_op.add_column(
            sa.Column(
                "country",
                sa.String(),
                nullable=False,
                server_default="us",
            )
        )
        batch_op.create_index("ix_articles_country", ["country"], unique=False)

    with op.batch_alter_table("articles") as batch_op:
        batch_op.alter_column("country", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch_op:
        batch_op.drop_index("ix_articles_country")
        batch_op.drop_column("country")
