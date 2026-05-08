from __future__ import annotations

from dataclasses import dataclass

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)

NOTICE_CHANGE_SET_TARGET_FAMILY_TRANSPORT_SCHEDULE = "transport_schedule"


@dataclass(frozen=True, slots=True)
class NoticeChangeSetAdmissionDecision:
    answer_eligible: bool
    admission_state: str
    reason_codes: tuple[str, ...]


def evaluate_transport_notice_change_set_admission(
    entry: NoticeConsumptionProjectionEntry,
    *,
    official_baseline_available: bool,
    source_title: str = "",
    source_url: str = "",
) -> NoticeChangeSetAdmissionDecision:
    reasons: list[str] = []

    if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY:
        return NoticeChangeSetAdmissionDecision(
            answer_eligible=False,
            admission_state="searchable_only",
            reason_codes=("notice_searchable_only",),
        )

    if not official_baseline_available:
        reasons.append("transport_baseline_missing")

    candidate_kind = str(entry.role_metadata.get("service_status_candidate_kind") or "").strip()
    if (
        entry.target_surface != NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        or candidate_kind != NOTICE_CHANGE_SET_TARGET_FAMILY_TRANSPORT_SCHEDULE
    ):
        reasons.append("transport_change_unsupported")

    if entry.consumption_status != NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET:
        reasons.append("transport_change_unsupported")

    if entry.completeness_status != NOTICE_COMPLETENESS_COMPLETE:
        reasons.append("notice_media_evidence_incomplete")

    if entry.answerability not in {
        NOTICE_ANSWERABILITY_ANSWERABLE,
        NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    }:
        reasons.append("transport_change_unsupported")

    resolved_title = _resolve_source_title(entry, source_title=source_title)
    if not resolved_title:
        reasons.append("notice_source_ref_missing")

    resolved_source_url = _resolve_source_url(entry, source_url=source_url)
    if not resolved_source_url:
        reasons.append("notice_source_ref_missing")

    normalized_reasons = tuple(dict.fromkeys(reasons))
    if not normalized_reasons:
        return NoticeChangeSetAdmissionDecision(
            answer_eligible=True,
            admission_state="answer_eligible",
            reason_codes=(),
        )

    return NoticeChangeSetAdmissionDecision(
        answer_eligible=False,
        admission_state=_admission_state_for_reasons(normalized_reasons),
        reason_codes=normalized_reasons,
    )


def _admission_state_for_reasons(reason_codes: tuple[str, ...]) -> str:
    if "transport_baseline_missing" in reason_codes:
        return "missing_baseline"
    if "notice_searchable_only" in reason_codes:
        return "searchable_only"
    if any(
        reason in reason_codes
        for reason in (
            "notice_media_evidence_incomplete",
            "notice_source_ref_missing",
        )
    ):
        return "missing_evidence"
    return "unsupported"


def _resolve_source_title(
    entry: NoticeConsumptionProjectionEntry,
    *,
    source_title: str,
) -> str:
    return (
        source_title.strip()
        or str(entry.role_metadata.get("notice_title") or "").strip()
        or str(entry.role_metadata.get("title") or "").strip()
    )


def _resolve_source_url(
    entry: NoticeConsumptionProjectionEntry,
    *,
    source_url: str,
) -> str:
    return (
        source_url.strip()
        or str(entry.role_metadata.get("source_url") or "").strip()
        or str(entry.role_metadata.get("notice_source_url") or "").strip()
    )


__all__ = [
    "NOTICE_CHANGE_SET_TARGET_FAMILY_TRANSPORT_SCHEDULE",
    "NoticeChangeSetAdmissionDecision",
    "evaluate_transport_notice_change_set_admission",
]
