from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentSourceRetentionDecision:
    attachment_ref_id: str
    attachment_capture_policy: str
    attachment_capture_state: str
    retention_class: str
    byte_fetch_required: bool
    required_source_object: bool
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceRetentionDecision:
    notice_capture_route: str
    attachment_decisions: tuple[AuthenticatedNoticeAttachmentSourceRetentionDecision, ...]
    attachment_capture_policy_counts: dict[str, int]
    required_source_object_count: int
    metadata_only_attachment_ref_count: int
    quarantine_attachment_ref_count: int


def build_authenticated_notice_source_retention_decision(
    *,
    notice_capture_route: str,
    attachment_refs: tuple[Mapping[str, object], ...],
    missing_fact_attachment_ref_ids: tuple[str, ...] = (),
    source_truth_required_attachment_ref_ids: tuple[str, ...] = (),
) -> AuthenticatedNoticeSourceRetentionDecision:
    missing_fact_attachment_refs = set(missing_fact_attachment_ref_ids)
    source_truth_required_attachment_refs = set(source_truth_required_attachment_ref_ids)
    attachment_decisions = tuple(
        _build_attachment_decision(
            notice_capture_route=notice_capture_route,
            attachment_ref_id=_require_attachment_ref_id(attachment_ref),
            missing_fact_attachment_refs=missing_fact_attachment_refs,
            source_truth_required_attachment_refs=source_truth_required_attachment_refs,
        )
        for attachment_ref in attachment_refs
    )
    policy_counts = Counter(decision.attachment_capture_policy for decision in attachment_decisions)
    return AuthenticatedNoticeSourceRetentionDecision(
        notice_capture_route=notice_capture_route,
        attachment_decisions=attachment_decisions,
        attachment_capture_policy_counts=dict(policy_counts),
        required_source_object_count=sum(
            decision.required_source_object for decision in attachment_decisions
        ),
        metadata_only_attachment_ref_count=policy_counts.get("metadata_only", 0),
        quarantine_attachment_ref_count=policy_counts.get("fetch_to_quarantine", 0),
    )


def _build_attachment_decision(
    *,
    notice_capture_route: str,
    attachment_ref_id: str,
    missing_fact_attachment_refs: set[str],
    source_truth_required_attachment_refs: set[str],
) -> AuthenticatedNoticeAttachmentSourceRetentionDecision:
    if notice_capture_route == "notice_level_query_only":
        return _metadata_only_attachment_decision(
            attachment_ref_id=attachment_ref_id,
            reason_codes=("notice_level_query_only",),
        )
    if notice_capture_route == "candidate_service_fact":
        if attachment_ref_id in missing_fact_attachment_refs:
            return AuthenticatedNoticeAttachmentSourceRetentionDecision(
                attachment_ref_id=attachment_ref_id,
                attachment_capture_policy="fetch_to_quarantine",
                attachment_capture_state="quarantine_pending",
                retention_class="quarantine_candidate",
                byte_fetch_required=True,
                required_source_object=False,
                reason_codes=("service_fact_missing_required_fact",),
            )
        return _metadata_only_attachment_decision(
            attachment_ref_id=attachment_ref_id,
            reason_codes=("service_fact_text_complete",),
        )
    if notice_capture_route == "candidate_document_owner":
        if attachment_ref_id in source_truth_required_attachment_refs:
            return AuthenticatedNoticeAttachmentSourceRetentionDecision(
                attachment_ref_id=attachment_ref_id,
                attachment_capture_policy="fetch_required_for_source_truth",
                attachment_capture_state="source_truth_fetch_required",
                retention_class="permanent_source_truth",
                byte_fetch_required=True,
                required_source_object=True,
                reason_codes=("source_truth_required_attachment",),
            )
        return _metadata_only_attachment_decision(
            attachment_ref_id=attachment_ref_id,
            reason_codes=("owner_not_admitted",),
        )
    raise ValueError(f"Unsupported notice_capture_route: {notice_capture_route}")


def _metadata_only_attachment_decision(
    *,
    attachment_ref_id: str,
    reason_codes: tuple[str, ...],
) -> AuthenticatedNoticeAttachmentSourceRetentionDecision:
    return AuthenticatedNoticeAttachmentSourceRetentionDecision(
        attachment_ref_id=attachment_ref_id,
        attachment_capture_policy="metadata_only",
        attachment_capture_state="metadata_recorded",
        retention_class="metadata_only",
        byte_fetch_required=False,
        required_source_object=False,
        reason_codes=reason_codes,
    )


def _require_attachment_ref_id(attachment_ref: Mapping[str, object]) -> str:
    attachment_ref_id = attachment_ref.get("attachment_ref_id")
    if not isinstance(attachment_ref_id, str) or not attachment_ref_id:
        raise ValueError("attachment_ref must include a non-empty attachment_ref_id")
    return attachment_ref_id


__all__ = [
    "AuthenticatedNoticeAttachmentSourceRetentionDecision",
    "AuthenticatedNoticeSourceRetentionDecision",
    "build_authenticated_notice_source_retention_decision",
]
