from __future__ import annotations

from campus_ingestion_core.wechat_public_notice_projection_models import WeChatArticleSourceTruth


def _has_pending_inline_image_outcome(article: WeChatArticleSourceTruth) -> bool:
    return any(item.status == "pending" for item in article.inline_image_outcomes)


def _has_terminal_inline_image_failure(article: WeChatArticleSourceTruth) -> bool:
    return any(
        item.status in {"fetch_failed", "ocr_failed"} for item in article.inline_image_outcomes
    )


def _inline_image_status_counts(article: WeChatArticleSourceTruth) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in article.inline_image_outcomes:
        counts[item.status] = counts.get(item.status, 0) + 1
    return dict(sorted(counts.items()))


def _aggregate_multimodal_summary(article: WeChatArticleSourceTruth) -> str:
    parts = [item.summary.strip() for item in article.inline_image_outcomes if item.summary.strip()]
    return "\n\n".join(dict.fromkeys(parts))


def _aggregate_multimodal_text(article: WeChatArticleSourceTruth) -> str:
    parts = [
        item.extracted_text.strip()
        for item in article.inline_image_outcomes
        if item.extracted_text.strip()
    ]
    return "\n\n".join(dict.fromkeys(parts))


def _article_ocr_required(article: WeChatArticleSourceTruth) -> bool:
    return article.body_state == "captured" and article.inline_image_count > 0


def _capture_gate_status(article: WeChatArticleSourceTruth) -> str:
    if article.body_state == "fetch_failed":
        return "fetch_failed"
    if article.body_state != "captured":
        return "body_not_captured"
    if article.inline_image_outcomes:
        if _has_pending_inline_image_outcome(article):
            return "multimodal_pending"
        if _has_terminal_inline_image_failure(article):
            return "multimodal_terminal_failure"
        if bool(article.body_paragraphs) or bool(
            _aggregate_multimodal_text(article) or _aggregate_multimodal_summary(article)
        ):
            return "multimodal_completed"
        return "multimodal_no_text"
    if article.body_paragraphs:
        return "captured_body"
    return "captured_without_text"


def _article_ocr_status(article: WeChatArticleSourceTruth) -> str:
    if not article.inline_image_outcomes:
        return "not_needed"
    if article.body_state != "captured":
        return "not_admitted"
    if _has_pending_inline_image_outcome(article):
        return "pending"
    if _has_terminal_inline_image_failure(article):
        return "terminal_failure"
    if bool(_aggregate_multimodal_summary(article) or _aggregate_multimodal_text(article)):
        return "admitted"
    return "no_extractable_text"


def _multimodal_processing_status(article: WeChatArticleSourceTruth) -> str:
    if not article.inline_image_outcomes:
        return "not_needed"
    if article.body_state != "captured":
        return "not_admitted"
    if _has_pending_inline_image_outcome(article):
        return "pending"
    if _has_terminal_inline_image_failure(article):
        return "terminal_failure"
    if bool(_aggregate_multimodal_summary(article) or _aggregate_multimodal_text(article)):
        return "completed"
    return "no_extractable_text"


def _processing_gap_reason(article: WeChatArticleSourceTruth) -> str:
    if article.body_state == "fetch_failed":
        return "fetch_failed"
    if article.body_state != "captured":
        return "body_not_captured"
    if article.inline_image_outcomes:
        if _has_pending_inline_image_outcome(article):
            return "multimodal_pending"
        if _has_terminal_inline_image_failure(article):
            return "multimodal_terminal_failure"
        if (
            not article.body_paragraphs
            and not _aggregate_multimodal_text(article)
            and not _aggregate_multimodal_summary(article)
        ):
            return "multimodal_no_extractable_text"
    return ""
