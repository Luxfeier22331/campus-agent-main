from __future__ import annotations

import html
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
class AuthenticatedNoticeFamilyRoutePolicy:
    family: str
    consumption_route: str
    machine_processing_policy: str
    terminal_reason: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeDefaultFamilyRouteOverride:
    name: str
    consumption_route: str
    machine_processing_policy: str
    any_terms: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingPolicyConfig:
    family_policies: dict[str, AuthenticatedNoticeFamilyRoutePolicy]
    terminal_no_adoption_title_patterns: tuple[str, ...]
    default_family_route_overrides: tuple[AuthenticatedNoticeDefaultFamilyRouteOverride, ...]
    machine_processing_value_terms: tuple[str, ...]


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
    routing_policy: AuthenticatedNoticeRoutingPolicyConfig


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
    if (
        str(payload.get("schema_version") or "")
        != AUTHENTICATED_NOTICE_NOTICE_FAMILY_SCHEMA_VERSION
    ):
        raise ValueError(
            "unsupported authenticated notice notice-family schema_version: "
            f"{payload.get('schema_version')!r}"
        )
    rules = tuple(
        sorted(
            (_load_rule(item) for item in list(payload.get("rules") or [])),
            key=lambda rule: rule.priority,
            reverse=True,
        )
    )
    if not rules:
        raise ValueError("at least one notice-family rule is required")
    routing_policy = _load_routing_policy(payload.get("routing_policy"))
    return AuthenticatedNoticeNoticeFamilyConfig(
        schema_version=str(payload["schema_version"]),
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        source_channel=str(payload.get("source_channel") or ""),
        default_family=str(payload.get("default_family") or "other"),
        default_admission_policy=str(payload.get("default_admission_policy") or "no_adoption"),
        default_priority=int(payload.get("default_priority") or 0),
        rules=rules,
        routing_policy=routing_policy,
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


def _load_routing_policy(payload: object) -> AuthenticatedNoticeRoutingPolicyConfig:
    raw = dict(payload or {})
    raw_family_policies = dict(raw.get("family_policies") or {})
    if not raw_family_policies:
        raise ValueError("notice-family routing_policy.family_policies is required")
    family_policies: dict[str, AuthenticatedNoticeFamilyRoutePolicy] = {}
    for family, policy_payload in raw_family_policies.items():
        policy = _load_family_route_policy(family=str(family), payload=policy_payload)
        family_policies[policy.family] = policy
    return AuthenticatedNoticeRoutingPolicyConfig(
        family_policies=family_policies,
        terminal_no_adoption_title_patterns=_normalize_text_list(
            raw.get("terminal_no_adoption_title_patterns")
        ),
        default_family_route_overrides=tuple(
            _load_default_family_route_override(item)
            for item in list(raw.get("default_family_route_overrides") or [])
        ),
        machine_processing_value_terms=_normalize_text_list(
            raw.get("machine_processing_value_terms")
        ),
    )


def _load_family_route_policy(
    *,
    family: str,
    payload: object,
) -> AuthenticatedNoticeFamilyRoutePolicy:
    raw = dict(payload or {})
    normalized_family = str(raw.get("family") or family).strip()
    if not normalized_family:
        raise ValueError("routing family policy requires family")
    consumption_route = str(raw.get("consumption_route") or "").strip()
    if not consumption_route:
        raise ValueError(f"routing family policy requires consumption_route for {family}")
    machine_processing_policy = str(raw.get("machine_processing_policy") or "").strip()
    if not machine_processing_policy:
        raise ValueError(f"routing family policy requires machine_processing_policy for {family}")
    return AuthenticatedNoticeFamilyRoutePolicy(
        family=normalized_family,
        consumption_route=consumption_route,
        machine_processing_policy=machine_processing_policy,
        terminal_reason=_normalize_optional_text(raw.get("terminal_reason")),
    )


def _load_default_family_route_override(
    payload: object,
) -> AuthenticatedNoticeDefaultFamilyRouteOverride:
    raw = dict(payload or {})
    name = str(raw.get("name") or "").strip()
    if not name:
        raise ValueError("default family route override requires name")
    consumption_route = str(raw.get("consumption_route") or "").strip()
    if not consumption_route:
        raise ValueError(f"default family route override {name} requires consumption_route")
    machine_processing_policy = str(raw.get("machine_processing_policy") or "").strip()
    if not machine_processing_policy:
        raise ValueError(
            f"default family route override {name} requires machine_processing_policy"
        )
    return AuthenticatedNoticeDefaultFamilyRouteOverride(
        name=name,
        consumption_route=consumption_route,
        machine_processing_policy=machine_processing_policy,
        any_terms=_normalize_text_list(raw.get("any_terms")),
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
    "AuthenticatedNoticeDefaultFamilyRouteOverride",
    "AuthenticatedNoticeFamilyRoutePolicy",
    "AuthenticatedNoticeNoticeFamilyClassification",
    "AuthenticatedNoticeNoticeFamilyConfig",
    "AuthenticatedNoticeNoticeFamilyRule",
    "AuthenticatedNoticeRoutingPolicyConfig",
    "classify_authenticated_notice_bundle_payload",
    "classify_authenticated_notice_bundle_record",
    "load_authenticated_notice_notice_family_config",
    "read_authenticated_notice_notice_family_config_path",
]
