import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("NEWS_API_KEY", "test-news-key")
os.environ.setdefault("ADMIN_EMAILS", "reader@example.com")

from app.services.summarizer import ArticleSummarizer  # noqa: E402


def test_shape_summary_enforces_mobile_display_constraints():
    summarizer = ArticleSummarizer()

    result = summarizer._shape_summary(
        title="Awaiting reinforcements, Padres adopt unconventional pitching plan before Deadline - MLB.com",
        display_headline="Awaiting reinforcements, Padres adopt unconventional pitching plan before Deadline - MLB.com",
        main_takeaway=(
            "The Padres are carrying a thin pitching staff as the trade deadline "
            "nears. They plan to spread innings across more pitchers while waiting "
            "to see whether reinforcements arrive."
        ),
        full_summary=(
            "The Padres are carrying a thin pitching staff as the trade deadline "
            "nears. They plan to spread innings across more pitchers while waiting "
            "to see whether reinforcements arrive. The approach could help protect "
            "the rotation during a key stretch."
        ),
        why_it_matters=(
            "The plan could shape San Diego's deadline urgency and affect how its "
            "pitching staff is managed."
        ),
        supporting_lines=["unused"],
        model_name="test-model",
    )

    assert result["display_headline"].startswith("Awaiting reinforcements")
    assert "MLB.com" not in result["display_headline"]
    assert len(result["display_headline"]) <= 90
    assert (
        summarizer._estimated_line_count(
            result["display_headline"],
            max_width_px=summarizer.HEADLINE_MAX_WIDTH_PX,
            font_size_px=summarizer.HEADLINE_FONT_SIZE_PX,
            family="serif",
        )
        <= 3
    )
    assert result["main_takeaway"].endswith(".")
    assert len(result["main_takeaway"].split()) <= 48
    assert (
        summarizer._estimated_line_count(
            result["main_takeaway"],
            max_width_px=summarizer.SUMMARY_MAX_WIDTH_PX,
            font_size_px=summarizer.SUMMARY_FONT_SIZE_PX,
            family="sans",
        )
        <= 7
    )
    assert result["supporting_lines"] == []
    assert result["summary_text"].count(".") >= 3
    assert result["why_it_matters"]


def test_invalid_why_it_matters_is_omitted():
    summarizer = ArticleSummarizer()

    result = summarizer._shape_summary(
        title="Short title",
        display_headline="Short title",
        main_takeaway="A company reported a new development and gave context.",
        full_summary="A company reported a new development and gave context.",
        why_it_matters="Useful.",
        supporting_lines=[],
        model_name="test-model",
    )

    assert result["why_it_matters"] == ""
