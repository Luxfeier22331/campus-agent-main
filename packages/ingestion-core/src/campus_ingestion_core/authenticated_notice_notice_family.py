from __future__ import annotations

from dataclasses import dataclass
import html
import json
from pathlib import Path
import re
from typing import Any, Sequence

from campus_ingestion_core.collection_config import resolve_collection_truth_config

AUTHENTICATED_NOTICE_NOTICE_FAMILY_SCHEMA_VERSION = (
    "authenticated_notice_notice_family_classification_v1"
)
DEFAULT_AUTHENTICATED_NOTICE_NOTICE_FAMILY_ENV_KEY = (
    "AUTHENTICATED_NOTICE_NOTICE_FAMILY_CONFIG_PATH"
)

DEFAULT_AUTHENTICATED_NOTICE_CORPUS = "campus_notices"
DEFAULT_AUTHENTICATED_NOTICE_COLLECTION = "internal_notice"


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeNoticeFamilyRule:
    family: str
    admission_policy: str
    priority: int
    description: str | None = None
    notice_type_ids: tuple[str, ...] = ()
    notice_type_names: tuple[str, ...] = ()
    title_any_patterns: tuple[str, ...] = ()
    body_any_patterns: tuple[str, ...] = ()
    title_exclude_patterns: tuple[str, ...] = ()
    body_exclude_patterns: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeNoticeFamilyConfig:
    schema_version: str
    corpus: str
    collection: str
    source_channel: str
    default_family: str
    default_admission_policy: str
    default_priority: int
    rules: tuple[AuthenticatedNoticeNoticeFamilyRule, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeNoticeFamilyClassification:
    family: str
    admission_policy: str
    priority: int
    matched_title_patterns: tuple[str, ...] = ()
    matched_body_patterns: tuple[str, ...] = ()
    matched_notice_type_ids: tuple[str, ...] = ()
    matched_notice_type_names: tuple[str, ...] = ()


def read_authenticated_notice_notice_family_config_path(
    source: dict[str, str],
) -> Path:
    override = (source.get(DEFAULT_AUTHENTICATED_NOTICE_NOTICE_FAMILY_ENV_KEY) or "").strip()
    if override:
        return Path(override)
    config = resolve_collection_truth_config(
        DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
        DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    )
    if config.notice_family_config_path is None:
        raise ValueError("internal_notice notice-family-classification.v1.json is required")
    return config.notice_family_config_path


def load_authenticated_notice_notice_family_config(
    path: Path,
) -> AuthenticatedNoticeNoticeFamilyConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if str(payload.get("schema_version") or "") != AUTHENTICATED_NOTICE_NOTICE_FAMILY_SCHEMA_VERSION:
        raise ValueError(
            "unsupported authenticated notice notice-family schema_version: "
            f"{payload.get('schema_version')!r}"
        )
    rules = tuple(_load_rule(item) for item in list(payload.get("rules") or []))
    if not rules:
        raise ValueError("at least one notice-family rule is required")
    return AuthenticatedNoticeNoticeFamilyConfig(
        schema_version=str(payload["schema_version"]),
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        source_channel=str(payload.get("source_channel") or ""),
        default_family=str(payload.get("default_family") or "other"),
        default_admission_policy=str(payload.get("default_admission_policy") or "review_later"),
        default_priority=int(payload.get("default_priority") or 0),
        rules=rules,
    )


def classify_authenticated_notice_bundle_record(
    bundle_record: dict[str, Any],
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeNoticeFamilyClassification:
    notice = dict(bundle_record.get("notice") or {})
    categories = tuple(dict(item) for item in list(notice.get("categories") or []))
    notice_type_ids = tuple(
        str(item.get("notice_type") or "").strip()
        for item in categories
        if str(item.get("notice_type") or "").strip()
    )
    notice_type_names = tuple(
        str(item.get("notice_type_name") or "").strip()
        for item in categories
        if str(item.get("notice_type_name") or "").strip()
    )
    title = _normalize_notice_text(notice.get("notice_title"))
    body = _normalize_notice_html(notice.get("notice_content"))

    for rule in config.rules:
        match = _match_rule(
            rule=rule,
            title=title,
            body=body,
            notice_type_ids=notice_type_ids,
            notice_type_names=notice_type_names,
        )
        if match is not None:
            return match
    return AuthenticatedNoticeNoticeFamilyClassification(
        family=config.default_family,
        admission_policy=config.default_admission_policy,
        priority=config.default_priority,
    )


def classify_authenticated_notice_bundle_payload(
    bundle_records: Sequence[dict[str, Any]],
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> tuple[AuthenticatedNoticeNoticeFamilyClassification, ...]:
    return tuple(
        classify_authenticated_notice_bundle_record(record, config=config)
        for record in bundle_records
    )


def _load_rule(payload: object) -> AuthenticatedNoticeNoticeFamilyRule:
    raw = dict(payload or {})
    family = str(raw.get("family") or "").strip()
    if not family:
        raise ValueError("notice-family rule family is required")
    admission_policy = str(raw.get("admission_policy") or "").strip()
    if not admission_policy:
        raise ValueError(f"notice-family rule admission_policy is required for {family}")
    return AuthenticatedNoticeNoticeFamilyRule(
        family=family,
        admission_policy=admission_policy,
        priority=int(raw.get("priority") or 0),
        description=_normalize_optional_text(raw.get("description")),
        notice_type_ids=_normalize_text_list(raw.get("notice_type_ids")),
        notice_type_names=_normalize_text_list(raw.get("notice_type_names")),
        title_any_patterns=_normalize_text_list(raw.get("title_any_patterns")),
        body_any_patterns=_normalize_text_list(raw.get("body_any_patterns")),
        title_exclude_patterns=_normalize_text_list(raw.get("title_exclude_patterns")),
        body_exclude_patterns=_normalize_text_list(raw.get("body_exclude_patterns")),
    )


def _match_rule(
    *,
    rule: AuthenticatedNoticeNoticeFamilyRule,
    title: str | None,
    body: str | None,
    notice_type_ids: tuple[str, ...],
    notice_type_names: tuple[str, ...],
) -> AuthenticatedNoticeNoticeFamilyClassification | None:
    title_text = title or ""
    body_text = body or ""

    matched_notice_type_ids = tuple(
        candidate for candidate in rule.notice_type_ids if candidate in notice_type_ids
    )
    matched_notice_type_names = tuple(
        candidate for candidate in rule.notice_type_names if candidate in notice_type_names
    )
    if rule.notice_type_ids and not matched_notice_type_ids:
        return None
    if rule.notice_type_names and not matched_notice_type_names:
        return None

    if _find_matching_patterns(rule.title_exclude_patterns, title_text):
        return None
    if _find_matching_patterns(rule.body_exclude_patterns, body_text):
        return None

    matched_title_patterns = _find_matching_patterns(rule.title_any_patterns, title_text)
    matched_body_patterns = _find_matching_patterns(rule.body_any_patterns, body_text)
    if rule.title_any_patterns and not matched_title_patterns:
        return None
    if rule.body_any_patterns and not matched_body_patterns:
        return None

    return AuthenticatedNoticeNoticeFamilyClassification(
        family=rule.family,
        admission_policy=rule.admission_policy,
        priority=rule.priority,
        matched_title_patterns=matched_title_patterns,
        matched_body_patterns=matched_body_patterns,
        matched_notice_type_ids=matched_notice_type_ids,
        matched_notice_type_names=matched_notice_type_names,
    )


def _find_matching_patterns(patterns: Sequence[str], text: str) -> tuple[str, ...]:
    matched: list[str] = []
    for pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            matched.append(str(pattern))
    return tuple(matched)


def _normalize_notice_html(value: object) -> str | None:
    text = _normalize_optional_text(value)
    if text is None:
        return None
    stripped = re.sub(r"<[^>]+>", "\n", text)
    stripped = html.unescape(stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    return stripped or None


def _normalize_notice_text(value: object) -> str | None:
    text = _normalize_optional_text(value)
    if text is None:
        return None
    normalized = html.unescape(text)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or None


def _normalize_optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_text_list(value: object) -> tuple[str, ...]:
    normalized: list[str] = []
    for item in list(value or []):
        text = _normalize_optional_text(item)
        if text is not None:
            normalized.append(text)
    return tuple(normalized)


__all__ = [
    "AUTHENTICATED_NOTICE_NOTICE_FAMILY_SCHEMA_VERSION",
    "AuthenticatedNoticeNoticeFamilyClassification",
    "AuthenticatedNoticeNoticeFamilyConfig",
    "AuthenticatedNoticeNoticeFamilyRule",
    "classify_authenticated_notice_bundle_payload",
    "classify_authenticated_notice_bundle_record",
    "load_authenticated_notice_notice_family_config",
    "read_authenticated_notice_notice_family_config_path",
]
