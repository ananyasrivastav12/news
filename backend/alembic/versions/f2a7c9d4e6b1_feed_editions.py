"""feed editions

Revision ID: f2a7c9d4e6b1
Revises: e6f1a2b3c4d5
Create Date: 2026-06-30 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f2a7c9d4e6b1"
down_revision: Union[str, None] = "e6f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "flashcards",
        sa.Column(
            "edition_type",
            sa.String(),
            nullable=False,
            server_default="morning_brief",
        ),
    )
    op.add_column(
        "flashcards",
        sa.Column(
            "market_timezone",
            sa.String(),
            nullable=False,
            server_default="America/New_York",
        ),
    )
    op.create_index(op.f("ix_flashcards_edition_type"), "flashcards", ["edition_type"])
    op.create_index(
        op.f("ix_flashcards_market_timezone"), "flashcards", ["market_timezone"]
    )
    op.drop_constraint("uq_feed_article", "flashcards", type_="unique")
    op.create_unique_constraint(
        "uq_feed_edition_article",
        "flashcards",
        ["user_id", "feed_date", "edition_type", "market_timezone", "article_id"],
    )
    op.create_unique_constraint(
        "uq_feed_edition_rank",
        "flashcards",
        ["user_id", "feed_date", "edition_type", "market_timezone", "rank_position"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_feed_edition_rank", "flashcards", type_="unique")
    op.drop_constraint("uq_feed_edition_article", "flashcards", type_="unique")
    op.create_unique_constraint(
        "uq_feed_article", "flashcards", ["user_id", "feed_date", "article_id"]
    )
    op.drop_index(op.f("ix_flashcards_market_timezone"), table_name="flashcards")
    op.drop_index(op.f("ix_flashcards_edition_type"), table_name="flashcards")
    op.drop_column("flashcards", "market_timezone")
    op.drop_column("flashcards", "edition_type")
