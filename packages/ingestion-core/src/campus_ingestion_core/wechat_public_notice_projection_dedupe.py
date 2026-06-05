from __future__ import annotations

from collections.abc import Mapping, Sequence

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
)
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatArticleSourceTruth,
    _DuplicateReferenceHit,
)
from campus_ingestion_core.wechat_public_notice_projection_scalars import (
    _text,
    _to_publish_day,
)


def _find_duplicate_reference(
    *,
    article: WeChatArticleSourceTruth,
    reference_signals: Mapping[str, tuple[str, str]],
    local_entries: Sequence[NoticeConsumptionProjectionEntry],
) -> _DuplicateReferenceHit | None:
    signals = _dedupe_signals_for_article(article)
    for dedupe_basis, signal in signals:
        existing = reference_signals.get(signal)
        if existing is not None:
            family, notice_id = existing
            if (
                family == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
                and notice_id == article.article_stable_id
            ):
                continue
            if _source_family_priority(family) >= _source_family_priority(
                WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
            ):
                return _DuplicateReferenceHit(
                    source_family=family,
                    source_notice_id=notice_id,
                    dedupe_basis=dedupe_basis,
                )
    local_signal_map = _build_reference_signal_map(local_entries)
    for dedupe_basis, signal in signals:
        existing = local_signal_map.get(signal)
        if existing is not None:
            family, notice_id = existing
            if (
                family == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
                and notice_id == article.article_stable_id
            ):
                continue
            return _DuplicateReferenceHit(
                source_family=family,
                source_notice_id=notice_id,
                dedupe_basis=dedupe_basis,
            )
    return None


def _build_reference_signal_map(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> dict[str, tuple[str, str]]:
    signal_map: dict[str, tuple[str, str]] = {}
    for entry in entries:
        signals = _dedupe_signals_for_projection_entry(entry)
        for signal in signals:
            signal_map.setdefault(signal, (entry.source_family, entry.source_notice_id))
    return signal_map


def _dedupe_signals_for_article(article: WeChatArticleSourceTruth) -> tuple[tuple[str, str], ...]:
    signals: list[tuple[str, str]] = []
    if article.normalized_article_url:
        signals.append(("normalized_article_url", f"url:{article.normalized_article_url}"))
        signals.append(
            (
                "account_slug+normalized_article_url",
                f"account_url:{article.account_slug}:{article.normalized_article_url}",
            )
        )
    if article.title_normalized and article.publish_day:
        signals.append(
            ("title+publish_day", f"title_day:{article.title_normalized}:{article.publish_day}")
        )
    if article.account_slug and article.provider_article_id:
        signals.append(
            (
                "account_slug+provider_article_id",
                f"provider_id:{article.account_slug}:{article.provider_article_id}",
            )
        )
    return tuple(signals)


def _dedupe_signals_for_projection_entry(
    entry: NoticeConsumptionProjectionEntry,
) -> tuple[str, ...]:
    metadata = dict(entry.role_metadata or {})
    account_slug = _text(metadata.get("account_slug"))
    normalized_article_url = _text(metadata.get("normalized_article_url")) or _text(
        metadata.get("source_url")
    )
    title_normalized = _text(metadata.get("title_normalized")) or _text(metadata.get("title"))
    publish_day = _to_publish_day(
        _text(metadata.get("publish_time")) or _text(metadata.get("published_at"))
    )
    provider_article_id = _text(metadata.get("provider_article_id"))

    signals: list[str] = []
    if normalized_article_url:
        signals.append(f"url:{normalized_article_url}")
    if account_slug and normalized_article_url:
        signals.append(f"account_url:{account_slug}:{normalized_article_url}")
    if title_normalized and publish_day:
        signals.append(f"title_day:{title_normalized}:{publish_day}")
    if account_slug and provider_article_id:
        signals.append(f"provider_id:{account_slug}:{provider_article_id}")
    return tuple(dict.fromkeys(signals))


def _source_family_priority(source_family: str) -> int:
    normalized = source_family.strip()
    if normalized == NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED:
        return 3
    if normalized == NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC:
        return 2
    if normalized == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY:
        return 1
    return 0
