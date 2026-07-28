# migration for admin pipeline and review tables
"""admin dashboard

Revision ID: e6f1a2b3c4d5
Revises: d3e7a9c2b5f1
Create Date: 2026-06-08 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e6f1a2b3c4d5"
down_revision: Union[str, None] = "d3e7a9c2b5f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


pipeline_run_status_enum = postgresql.ENUM(
    "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", name="pipelinerunstatus"
)


def upgrade() -> None:
    bind = op.get_bind()
    pipeline_run_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "pipeline_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_type", sa.String(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "QUEUED",
                "RUNNING",
                "SUCCEEDED",
                "FAILED",
                name="pipelinerunstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("fetched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inserted_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "duplicates_skipped_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "invalid_skipped_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("summarized_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "summary_failed_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("embedded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("feed_items_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "metadata_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pipeline_runs_id"), "pipeline_runs", ["id"])
    op.create_index("ix_pipeline_runs_run_type", "pipeline_runs", ["run_type"])
    op.create_index("ix_pipeline_runs_status", "pipeline_runs", ["status"])

    op.create_table(
        "pipeline_run_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pipeline_run_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["pipeline_run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pipeline_run_logs_id"), "pipeline_run_logs", ["id"])
    op.create_index(
        op.f("ix_pipeline_run_logs_created_at"), "pipeline_run_logs", ["created_at"]
    )

    op.create_table(
        "summary_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("summary_id", sa.Integer(), nullable=True),
        sa.Column("reviewer_user_id", sa.Integer(), nullable=True),
        sa.Column("rating", sa.String(), nullable=False),
        sa.Column("issue_type", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"]),
        sa.ForeignKeyConstraint(["summary_id"], ["summaries.id"]),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_summary_reviews_id"), "summary_reviews", ["id"])
    op.create_index(
        op.f("ix_summary_reviews_article_id"), "summary_reviews", ["article_id"]
    )
    op.create_index(
        op.f("ix_summary_reviews_summary_id"), "summary_reviews", ["summary_id"]
    )
    op.create_index(
        op.f("ix_summary_reviews_created_at"), "summary_reviews", ["created_at"]
    )

    op.create_table(
        "pipeline_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "schedule_type",
            sa.String(),
            nullable=False,
            server_default="full_pipeline",
        ),
        sa.Column("hour", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("minute", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "countries",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "categories",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column("article_target", sa.Integer(), nullable=True),
        sa.Column("summary_limit", sa.Integer(), nullable=True),
        sa.Column(
            "force_feeds", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pipeline_schedules_id"), "pipeline_schedules", ["id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_pipeline_schedules_id"), table_name="pipeline_schedules")
    op.drop_table("pipeline_schedules")

    op.drop_index(op.f("ix_summary_reviews_created_at"), table_name="summary_reviews")
    op.drop_index(op.f("ix_summary_reviews_summary_id"), table_name="summary_reviews")
    op.drop_index(op.f("ix_summary_reviews_article_id"), table_name="summary_reviews")
    op.drop_index(op.f("ix_summary_reviews_id"), table_name="summary_reviews")
    op.drop_table("summary_reviews")

    op.drop_index(
        op.f("ix_pipeline_run_logs_created_at"), table_name="pipeline_run_logs"
    )
    op.drop_index(op.f("ix_pipeline_run_logs_id"), table_name="pipeline_run_logs")
    op.drop_table("pipeline_run_logs")

    op.drop_index("ix_pipeline_runs_status", table_name="pipeline_runs")
    op.drop_index("ix_pipeline_runs_run_type", table_name="pipeline_runs")
    op.drop_index(op.f("ix_pipeline_runs_id"), table_name="pipeline_runs")
    op.drop_table("pipeline_runs")

    bind = op.get_bind()
    pipeline_run_status_enum.drop(bind, checkfirst=True)
