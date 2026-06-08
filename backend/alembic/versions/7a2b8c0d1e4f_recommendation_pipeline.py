"""recommendation pipeline

Revision ID: 7a2b8c0d1e4f
Revises: b0b824e01c62
Create Date: 2026-03-15 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "7a2b8c0d1e4f"
down_revision: Union[str, None] = "b0b824e01c62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


summary_status_enum = postgresql.ENUM(
    "PENDING", "COMPLETED", "FAILED", name="summarystatus"
)
interaction_type_enum = postgresql.ENUM(
    "VIEW", "SKIP", "CLICK", "LIKE", "SAVE", name="interactiontype"
)


def upgrade() -> None:
    bind = op.get_bind()
    summary_status_enum.create(bind, checkfirst=True)
    interaction_type_enum.create(bind, checkfirst=True)

    with op.batch_alter_table("articles") as batch_op:
        batch_op.add_column(sa.Column("normalized_title", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("raw_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("cleaned_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("primary_category", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("image_url", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "keywords",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'::json"),
            )
        )
        batch_op.add_column(sa.Column("story_key", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "summary_status",
                summary_status_enum,
                nullable=False,
                server_default="PENDING",
            )
        )
        batch_op.add_column(
            sa.Column(
                "fetched_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            )
        )
        batch_op.add_column(
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index(
            "ix_articles_normalized_title", ["normalized_title"], unique=False
        )
        batch_op.create_index(
            "ix_articles_primary_category", ["primary_category"], unique=False
        )
        batch_op.create_index(
            "ix_articles_published_at", ["published_at"], unique=False
        )
        batch_op.create_index("ix_articles_source", ["source"], unique=False)
        batch_op.create_index("ix_articles_story_key", ["story_key"], unique=False)

    op.execute(
        """
        UPDATE articles
        SET normalized_title = lower(regexp_replace(title, '[^a-zA-Z0-9 ]', ' ', 'g')),
            description = COALESCE(description, ''),
            raw_text = COALESCE(title, '') || E'\n' || COALESCE(content, ''),
            cleaned_text = COALESCE(title, '') || ' ' || COALESCE(content, ''),
            primary_category = COALESCE(primary_category, 'general'),
            story_key = substring(md5(lower(COALESCE(title, original_url))) for 16)
        """
    )

    with op.batch_alter_table("articles") as batch_op:
        batch_op.alter_column("normalized_title", nullable=False)
        batch_op.alter_column("primary_category", nullable=False)
        batch_op.alter_column("story_key", nullable=False)

    with op.batch_alter_table("summaries") as batch_op:
        batch_op.add_column(sa.Column("main_takeaway", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "supporting_lines",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'::json"),
            )
        )
        batch_op.add_column(sa.Column("model_name", sa.String(), nullable=True))

    op.execute(
        "UPDATE summaries SET main_takeaway = summary_text WHERE main_takeaway IS NULL"
    )

    with op.batch_alter_table("summaries") as batch_op:
        batch_op.alter_column("article_id", nullable=False)
        batch_op.alter_column("main_takeaway", nullable=False)
        batch_op.create_unique_constraint("uq_summaries_article_id", ["article_id"])

    with op.batch_alter_table("flashcards") as batch_op:
        batch_op.add_column(sa.Column("article_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "feed_date",
                sa.Date(),
                nullable=False,
                server_default=sa.text("CURRENT_DATE"),
            )
        )
        batch_op.add_column(
            sa.Column("rank_position", sa.Integer(), nullable=False, server_default="1")
        )
        batch_op.add_column(
            sa.Column("ranking_score", sa.Float(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("ranking_reason", sa.String(), nullable=True))

    op.execute(
        """
        UPDATE flashcards
        SET article_id = summaries.article_id
        FROM summaries
        WHERE flashcards.summary_id = summaries.id
        """
    )

    with op.batch_alter_table("flashcards") as batch_op:
        batch_op.alter_column("user_id", nullable=False)
        batch_op.alter_column("summary_id", nullable=False)
        batch_op.alter_column("article_id", nullable=False)
        batch_op.alter_column("is_viewed", nullable=False, server_default=sa.false())
        batch_op.create_foreign_key(
            "fk_flashcards_article_id", "articles", ["article_id"], ["id"]
        )
        batch_op.create_index("ix_flashcards_feed_date", ["feed_date"], unique=False)
        batch_op.create_unique_constraint(
            "uq_feed_article", ["user_id", "feed_date", "article_id"]
        )

    op.create_table(
        "user_article_interactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column(
            "interaction_type",
            postgresql.ENUM(
                "VIEW",
                "SKIP",
                "CLICK",
                "LIKE",
                "SAVE",
                name="interactiontype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("dwell_time_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "metadata_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_article_interactions_id"),
        "user_article_interactions",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_article_interactions_user_id"),
        "user_article_interactions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_article_interactions_article_id"),
        "user_article_interactions",
        ["article_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_article_interactions_created_at"),
        "user_article_interactions",
        ["created_at"],
        unique=False,
    )

    op.create_table(
        "user_category_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category", name="uq_user_category_preference"),
    )
    op.create_index(
        op.f("ix_user_category_preferences_id"),
        "user_category_preferences",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_category_preferences_user_id"),
        "user_category_preferences",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_category_preferences_category"),
        "user_category_preferences",
        ["category"],
        unique=False,
    )

    op.create_table(
        "user_keyword_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("keyword", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "keyword", name="uq_user_keyword_preference"),
    )
    op.create_index(
        op.f("ix_user_keyword_preferences_id"),
        "user_keyword_preferences",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_keyword_preferences_user_id"),
        "user_keyword_preferences",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_keyword_preferences_keyword"),
        "user_keyword_preferences",
        ["keyword"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_user_keyword_preferences_keyword"),
        table_name="user_keyword_preferences",
    )
    op.drop_index(
        op.f("ix_user_keyword_preferences_user_id"),
        table_name="user_keyword_preferences",
    )
    op.drop_index(
        op.f("ix_user_keyword_preferences_id"), table_name="user_keyword_preferences"
    )
    op.drop_table("user_keyword_preferences")

    op.drop_index(
        op.f("ix_user_category_preferences_category"),
        table_name="user_category_preferences",
    )
    op.drop_index(
        op.f("ix_user_category_preferences_user_id"),
        table_name="user_category_preferences",
    )
    op.drop_index(
        op.f("ix_user_category_preferences_id"), table_name="user_category_preferences"
    )
    op.drop_table("user_category_preferences")

    op.drop_index(
        op.f("ix_user_article_interactions_created_at"),
        table_name="user_article_interactions",
    )
    op.drop_index(
        op.f("ix_user_article_interactions_article_id"),
        table_name="user_article_interactions",
    )
    op.drop_index(
        op.f("ix_user_article_interactions_user_id"),
        table_name="user_article_interactions",
    )
    op.drop_index(
        op.f("ix_user_article_interactions_id"), table_name="user_article_interactions"
    )
    op.drop_table("user_article_interactions")

    with op.batch_alter_table("flashcards") as batch_op:
        batch_op.drop_constraint("uq_feed_article", type_="unique")
        batch_op.drop_index("ix_flashcards_feed_date")
        batch_op.drop_constraint("fk_flashcards_article_id", type_="foreignkey")
        batch_op.drop_column("ranking_reason")
        batch_op.drop_column("ranking_score")
        batch_op.drop_column("rank_position")
        batch_op.drop_column("feed_date")
        batch_op.drop_column("article_id")

    with op.batch_alter_table("summaries") as batch_op:
        batch_op.drop_constraint("uq_summaries_article_id", type_="unique")
        batch_op.drop_column("model_name")
        batch_op.drop_column("supporting_lines")
        batch_op.drop_column("main_takeaway")

    with op.batch_alter_table("articles") as batch_op:
        batch_op.drop_index("ix_articles_story_key")
        batch_op.drop_index("ix_articles_source")
        batch_op.drop_index("ix_articles_published_at")
        batch_op.drop_index("ix_articles_primary_category")
        batch_op.drop_index("ix_articles_normalized_title")
        batch_op.drop_column("processed_at")
        batch_op.drop_column("fetched_at")
        batch_op.drop_column("summary_status")
        batch_op.drop_column("story_key")
        batch_op.drop_column("keywords")
        batch_op.drop_column("image_url")
        batch_op.drop_column("primary_category")
        batch_op.drop_column("cleaned_text")
        batch_op.drop_column("raw_text")
        batch_op.drop_column("description")
        batch_op.drop_column("normalized_title")

    interaction_type_enum.drop(op.get_bind(), checkfirst=True)
    summary_status_enum.drop(op.get_bind(), checkfirst=True)
