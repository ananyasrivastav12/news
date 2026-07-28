# tests summary shaping for mobile card constraints
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
    assert len(result["main_takeaway"].split()) <= summarizer.SUMMARY_MAX_WORDS
    assert (
        summarizer._estimated_line_count(
            result["main_takeaway"],
            max_width_px=summarizer.SUMMARY_MAX_WIDTH_PX,
            font_size_px=summarizer.SUMMARY_FONT_SIZE_PX,
            family="sans",
        )
        <= summarizer.SUMMARY_MAX_LINES
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


def test_shape_summary_uses_full_summary_when_card_body_is_too_short():
    summarizer = ArticleSummarizer()

    result = summarizer._shape_summary(
        title="Apple smart glasses privacy plan",
        display_headline="Apple smart glasses privacy plan",
        main_takeaway="Apple is expected to make privacy central to its smart glasses.",
        full_summary=(
            "Apple is expected to make privacy central to its smart glasses as it "
            "prepares a possible product reveal next June. The company is trying "
            "to separate its wearable from rivals by limiting how cameras, data, "
            "and visible recording features are handled. That approach could shape "
            "whether customers see the device as useful daily hardware or another "
            "always-on camera."
        ),
        why_it_matters="",
        supporting_lines=[],
        model_name="test-model",
    )

    assert "possible product reveal" in result["main_takeaway"]
    assert len(result["main_takeaway"].split()) > len(
        "Apple is expected to make privacy central to its smart glasses.".split()
    )
    assert (
        summarizer._estimated_line_count(
            result["main_takeaway"],
            max_width_px=summarizer.SUMMARY_MAX_WIDTH_PX,
            font_size_px=summarizer.SUMMARY_FONT_SIZE_PX,
            family="sans",
        )
        <= summarizer.SUMMARY_MAX_LINES
    )


def test_short_openai_card_body_gets_validation_feedback():
    summarizer = ArticleSummarizer()

    issues = summarizer._display_copy_issues(
        {
            "display_headline": "Apple smart glasses privacy plan",
            "main_takeaway": (
                "Apple is expected to make privacy central to its smart glasses."
            ),
            "why_it_matters": "",
        }
    )

    assert any("under" in issue for issue in issues)
