from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    sample_authenticated_notice_routing_from_bundle_record,
)

CLASSIFICATION_SCHEMA_VERSION = "collected_notice_classification.v1"

_TRANSPORT_TARGET_TITLE_PATTERNS = (
    r"校车.*(运行|运营|班次|时间|调整|安排)",
    r"班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"通勤班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"通勤车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"地铁接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"专车",
    r"乘车点",
    r"班次推迟",
)

_SERVICE_STATUS_TARGET_TITLE_PATTERNS = (
    r"暑假期间.*办理",
    r"寒假期间.*办理",
    r"假期期间.*办理",
    r"暂停.*(服务|办理|使用|访问|营业)",
    r"恢复.*(服务|办理|使用|开放|营业|浴室|正常)",
    r"(临时|暂时).*(关闭|停用|办理)",
    r"开放时间",
    r"服务时间",
    r"营业时间",
    r"工作安排",
    r"门诊",
    r"开诊",
    r"闭馆",
    r"食堂.*开放",
    r"校医院",
    r"浴室.*(试运行|恢复|开放)",
    r"停车权限",
    r"停水",
    r"停电",
    r"断网",
    r"升级维护",
)


def classify_collected_notice_unit(
    *,
    source_identifier: str,
    source_surface: str,
    title: str,
    body_text: str,
    attachment_refs: Sequence[Mapping[str, Any]],
    notice_type_names: Sequence[str] = (),
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> dict[str, Any]:
    sample = sample_authenticated_notice_routing_from_bundle_record(
        _routing_bundle_record(
            source_identifier=source_identifier,
            title=title,
            body_text=body_text,
            attachment_refs=attachment_refs,
            notice_type_names=notice_type_names,
        ),
        config=config,
    )
    target_candidates = resolve_collected_notice_target_candidates(
        notice_family=sample.notice_family,
        primary_route=sample.suggested_consumption_route,
        title=title,
    )
    evidence_strength = _evidence_strength(
        target_candidates=target_candidates,
        matched_title_patterns=sample.matched_title_patterns,
        matched_body_patterns=sample.matched_body_patterns,
    )
    return {
        "schema_version": CLASSIFICATION_SCHEMA_VERSION,
        "notice_family": sample.notice_family,
        "primary_route": sample.suggested_consumption_route,
        "processing_policy": sample.machine_processing_policy,
        "attachment_processing_policy": sample.attachment_processing_policy,
        "attachment_processing_reason": sample.attachment_processing_reason,
        "target_candidates": target_candidates,
        "evidence_strength": evidence_strength,
        "routing_reason_codes": _routing_reason_codes(
            notice_family=sample.notice_family,
            primary_route=sample.suggested_consumption_route,
            target_candidates=target_candidates,
            evidence_strength=evidence_strength,
        ),
        "matched_title_patterns": list(sample.matched_title_patterns),
        "matched_body_patterns": list(sample.matched_body_patterns),
        "admission_policy": sample.admission_policy,
        "priority": sample.priority,
    }


def classification_target_candidates(unit: Mapping[str, Any]) -> list[str]:
    classification = unit.get("classification")
    if not isinstance(classification, Mapping):
        return []
    raw = classification.get("target_candidates")
    if not isinstance(raw, Sequence) or isinstance(raw, str):
        return []
    return list(dict.fromkeys(str(item).strip() for item in raw if str(item).strip()))


def classification_primary_route(unit: Mapping[str, Any]) -> str:
    classification = unit.get("classification")
    if not isinstance(classification, Mapping):
        return ""
    return str(classification.get("primary_route") or "").strip()


def classification_notice_family(unit: Mapping[str, Any]) -> str:
    classification = unit.get("classification")
    if not isinstance(classification, Mapping):
        return ""
    return str(classification.get("notice_family") or "").strip()


def classification_evidence_strength(unit: Mapping[str, Any]) -> str:
    classification = unit.get("classification")
    if not isinstance(classification, Mapping):
        return ""
    return str(classification.get("evidence_strength") or "").strip()


def _routing_bundle_record(
    *,
    source_identifier: str,
    title: str,
    body_text: str,
    attachment_refs: Sequence[Mapping[str, Any]],
    notice_type_names: Sequence[str],
) -> dict[str, Any]:
    return {
        "notice_id": source_identifier,
        "notice": {
            "notice_id": source_identifier,
            "notice_title": title,
            "notice_content": body_text,
            "categories": [
                {"notice_type": "", "notice_type_name": str(name)}
                for name in notice_type_names
                if str(name).strip()
            ],
        },
        "notice_attachments": [_attachment_route_ref(ref) for ref in attachment_refs],
        "attachments": [],
    }


def _attachment_route_ref(ref: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "attachment_ref_id": ref.get("attachment_ref_id"),
        "resource_role": ref.get("resource_role"),
        "anchor_text": ref.get("anchor_text") or ref.get("original_filename"),
        "mime_type": ref.get("mime_type"),
        "object_key": ref.get("object_key"),
    }


def resolve_collected_notice_target_candidates(
    *,
    notice_family: str,
    primary_route: str,
    title: str,
) -> list[str]:
    if primary_route == "regulation_candidate":
        return ["regulation"]
    if primary_route == "service_status_candidate":
        if _is_transport_schedule_target(notice_family=notice_family, title=title):
            return ["transport_schedule"]
        if _is_service_status_target(notice_family=notice_family, title=title):
            return ["service_status"]
    return []


def _is_transport_schedule_target(*, notice_family: str, title: str) -> bool:
    if notice_family not in {"transport_commute_status", "facility_transport_classroom_status"}:
        return False
    return _matches_any(_TRANSPORT_TARGET_TITLE_PATTERNS, title)


def _is_service_status_target(*, notice_family: str, title: str) -> bool:
    if notice_family not in {
        "service_status_override",
        "facility_service_status",
        "facility_transport_classroom_status",
        "it_platform_service_status",
        "library_service_status",
    }:
        return False
    return _matches_any(_SERVICE_STATUS_TARGET_TITLE_PATTERNS, title)


def _matches_any(patterns: Sequence[str], value: str) -> bool:
    return any(re.search(pattern, value, flags=re.IGNORECASE) for pattern in patterns)


def _evidence_strength(
    *,
    target_candidates: Sequence[str],
    matched_title_patterns: Sequence[str],
    matched_body_patterns: Sequence[str],
) -> str:
    if not target_candidates:
        return "none"
    if matched_title_patterns:
        return "strong"
    if matched_body_patterns:
        return "body_signal"
    return "route_signal"


def _routing_reason_codes(
    *,
    notice_family: str,
    primary_route: str,
    target_candidates: Sequence[str],
    evidence_strength: str,
) -> list[str]:
    reasons = [f"notice_family:{notice_family}", f"route:{primary_route}"]
    if target_candidates:
        reasons.append(f"target_candidates:{','.join(target_candidates)}")
    reasons.append(f"evidence_strength:{evidence_strength}")
    return reasons


__all__ = [
    "CLASSIFICATION_SCHEMA_VERSION",
    "classification_evidence_strength",
    "classification_notice_family",
    "classification_primary_route",
    "classification_target_candidates",
    "classify_collected_notice_unit",
    "resolve_collected_notice_target_candidates",
]
