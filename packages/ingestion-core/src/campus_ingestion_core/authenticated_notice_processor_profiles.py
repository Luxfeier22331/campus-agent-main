from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

AUTHENTICATED_NOTICE_PROCESSOR_PROFILE_SCHEMA_VERSION = "authenticated_notice_processor_profile.v1"

_DEFAULT_RETRY_BUDGETS = {
    "object_store_verification": {
        "max_attempts": 3,
        "retry_after_seconds": 300,
        "retryable_reason_codes": ["source_object_read_failed", "source_object_unavailable"],
    },
    "text_extraction": {
        "max_attempts": 1,
        "retry_after_seconds": 0,
        "retryable_reason_codes": [],
    },
    "ocr_table_extraction": {
        "max_attempts": 3,
        "retry_after_seconds": 600,
        "retryable_reason_codes": ["ocr_provider_unavailable", "ocr_timeout"],
    },
    "multimodal_enrichment": {
        "max_attempts": 2,
        "retry_after_seconds": 900,
        "retryable_reason_codes": ["multimodal_provider_unavailable", "multimodal_timeout"],
    },
    "downstream_materialization": {
        "max_attempts": 2,
        "retry_after_seconds": 300,
        "retryable_reason_codes": ["projection_store_unavailable"],
    },
    "cleanup_evaluation": {
        "max_attempts": 1,
        "retry_after_seconds": 0,
        "retryable_reason_codes": [],
    },
}

_DEFAULT_RESOURCE_BUDGETS = {
    "object_store_verification": {"max_concurrency": 16, "timeout_seconds": 60},
    "text_extraction": {"max_concurrency": 8, "timeout_seconds": 30},
    "ocr_table_extraction": {"max_concurrency": 4, "timeout_seconds": 180},
    "multimodal_enrichment": {"max_concurrency": 2, "timeout_seconds": 240},
    "downstream_materialization": {"max_concurrency": 4, "timeout_seconds": 120},
    "cleanup_evaluation": {"max_concurrency": 8, "timeout_seconds": 60},
}

_PROFILES: dict[str, dict[str, Any]] = {
    "text_notice": {
        "profile_id": "text_notice",
        "source_surfaces": ["notice"],
        "target_families": ["transport_schedule", "service_status", "regulation", "searchable"],
        "media_role_rules": ["body_text_has_target_facts"],
        "processor_order": ["text_extraction", "downstream_materialization"],
        "multimodal_policy": "not_selected",
        "escalation_reason_codes": [],
    },
    "image_schedule_notice": {
        "profile_id": "image_schedule_notice",
        "source_surfaces": ["notice"],
        "target_families": ["transport_schedule"],
        "media_role_rules": ["schedule_table_carrier", "schedule_or_overlay_candidate"],
        "processor_order": [
            "ocr_table_extraction",
            "fact_readiness_evaluation",
            "multimodal_enrichment",
            "downstream_materialization",
        ],
        "multimodal_policy": "explicit_escalation_only",
        "escalation_reason_codes": [
            "ocr_low_confidence",
            "ocr_no_valid_rows",
            "route_or_date_context_missing",
            "semantic_image_not_table",
            "unsupported_ocr_media",
        ],
    },
    "attachment_owner_text_notice": {
        "profile_id": "attachment_owner_text_notice",
        "source_surfaces": ["notice", "file_release"],
        "target_families": ["regulation", "service_status", "searchable"],
        "media_role_rules": ["attachment_owner_text_required"],
        "processor_order": [
            "object_store_verification",
            "text_extraction",
            "fact_readiness_evaluation",
            "downstream_materialization",
        ],
        "multimodal_policy": "explicit_escalation_only",
        "escalation_reason_codes": ["owner_text_missing", "unsupported_attachment_text"],
    },
    "mixed_notice": {
        "profile_id": "mixed_notice",
        "source_surfaces": ["notice"],
        "target_families": ["transport_schedule", "service_status", "regulation", "searchable"],
        "media_role_rules": ["mixed_body_media_attachment_facts"],
        "processor_order": [
            "text_extraction",
            "ocr_table_extraction",
            "fact_readiness_evaluation",
            "multimodal_enrichment",
            "downstream_materialization",
        ],
        "multimodal_policy": "explicit_escalation_only",
        "escalation_reason_codes": ["fact_readiness_incomplete", "semantic_media_required"],
    },
}


def get_processor_profile(profile_id: str) -> dict[str, Any]:
    normalized = str(profile_id or "").strip()
    try:
        profile = dict(_PROFILES[normalized])
    except KeyError as exc:
        raise ValueError(
            f"unsupported authenticated notice processor profile: {normalized}"
        ) from exc
    processors = list(profile["processor_order"])
    profile["schema_version"] = AUTHENTICATED_NOTICE_PROCESSOR_PROFILE_SCHEMA_VERSION
    profile["retry_budget_by_processor"] = {
        key: dict(value) for key, value in _DEFAULT_RETRY_BUDGETS.items() if key in processors
    }
    profile["resource_budget_by_processor"] = {
        key: dict(value) for key, value in _DEFAULT_RESOURCE_BUDGETS.items() if key in processors
    }
    return profile


def select_processor_profile(
    *,
    source_surface: str,
    target_family: str,
    media_roles: Sequence[str] | None = None,
    sample_id: str | None = None,
    title: str = "",
    body_has_target_facts: bool = False,
) -> dict[str, Any]:
    normalized_surface = str(source_surface or "").strip()
    normalized_target = str(target_family or "").strip()
    normalized_sample_id = str(sample_id or "").strip()
    roles = {str(role or "").strip() for role in media_roles or () if str(role or "").strip()}
    title_text = str(title or "")
    reason_codes: list[str] = []

    if body_has_target_facts:
        profile_id = "text_notice"
        reason_codes.append("body_text_has_target_facts")
    elif normalized_target == "transport_schedule" and (
        "schedule_table_carrier" in roles
        or "schedule_or_overlay_candidate" in roles
        or normalized_sample_id == "355867"
        or ("班车" in title_text and "接驳" in title_text)
    ):
        profile_id = "image_schedule_notice"
        reason_codes.append("schedule_table_media_candidate")
        if normalized_sample_id == "355867":
            reason_codes.append("sample_355867_image_carried_schedule")
    elif "attachment_owner_text_required" in roles or normalized_surface == "file_release":
        profile_id = "attachment_owner_text_notice"
        reason_codes.append("attachment_owner_text_required")
    else:
        profile_id = "mixed_notice"
        reason_codes.append("mixed_or_unknown_notice")

    profile = get_processor_profile(profile_id)
    profile["selected_for"] = {
        "source_surface": normalized_surface,
        "target_family": normalized_target,
        "sample_id": normalized_sample_id,
        "media_roles": sorted(roles),
    }
    profile["reason_codes"] = reason_codes
    return profile


def profile_retry_budget(
    profile: Mapping[str, Any],
    processor: str,
) -> dict[str, Any]:
    budgets = profile.get("retry_budget_by_processor")
    if isinstance(budgets, Mapping):
        value = budgets.get(processor)
        if isinstance(value, Mapping):
            return dict(value)
    return {}


__all__ = [
    "AUTHENTICATED_NOTICE_PROCESSOR_PROFILE_SCHEMA_VERSION",
    "get_processor_profile",
    "profile_retry_budget",
    "select_processor_profile",
]
