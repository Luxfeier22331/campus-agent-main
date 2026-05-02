from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_candidate_store_noop_assertion,
    build_serving_closed_assertion,
)

HISTORICAL_REGULATION_DENOMINATOR_EXPANSION_SCHEMA_VERSION = (
    "historical_regulation_denominator_expansion.v1"
)

READY_FOR_CANONICAL_CHUNK_V9 = "ready_for_canonical_chunk_v9"
NEEDS_OWNER_TEXT_RECOVERY = "needs_owner_text_recovery"
DUPLICATE_HOLD = "duplicate_hold"
EXCLUDED_BY_OPERATOR_POLICY = "excluded_by_operator_policy"
DEFER_WRAPPER_SUMMARY_BACKLOG = "defer_wrapper_summary_backlog"
ALREADY_IN_COMPLETED_V9_COHORT = "already_in_completed_v9_cohort"

BODY_TEXT_SOURCE_SHAPES = {
    "body_is_policy_text",
    "body_contains_substantial_policy_text",
}
WRAPPER_SOURCE_SHAPES = {
    "wrapper_notice_likely_external_canonical_text",
}
WRAPPER_SUMMARY_SOURCE_SHAPES = {
    "wrapper_or_summary_notice",
}

OPERATOR_EXCLUDED_NOTICE_IDS = {
    "351119": "operator_excluded_from_owner_recovery",
}

DUPLICATE_SURVIVOR_BY_NOTICE_ID = {
    "191177": "191176",
}

SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT = {
    "187233": "body_text_not_complete_owner_policy",
}

SCOPED_RULE_TITLE_MARKERS = (
    "硕博连读",
    "推荐",
    "免试攻读研究生",
    "学院",
)
DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS = ("institutional_rules",)
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")


def build_historical_regulation_denominator_expansion_audit(
    *,
    batch_config: Mapping[str, Any],
    cohort_manifest: Mapping[str, Any],
    wrapper_follow_up_manifest: Mapping[str, Any] | None = None,
    completed_v9_admission_manifest: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
    generated_by: str = ("campus_ingestion_core.historical_regulation_denominator_expansion"),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    notices = _notice_rows(batch_config)
    cohort_a_ids = _cohort_notice_ids(cohort_manifest, "A")
    wrapper_ids = set(_wrapper_notice_ids(wrapper_follow_up_manifest or {}))
    completed_ids = _completed_source_notice_ids(completed_v9_admission_manifest or {})
    records = [
        _build_record(
            notice=notice,
            cohort_a_ids=cohort_a_ids,
            wrapper_ids=wrapper_ids,
            completed_ids=completed_ids,
        )
        for notice in notices
    ]
    status_counts = Counter(str(record["status"]) for record in records)
    source_shape_counts = Counter(str(record["source_shape"]) for record in records)
    target_collection_counts = Counter(
        str(record["target_collection"])
        for record in records
        if str(record.get("target_collection") or "")
    )
    ready_records = [
        record for record in records if record["status"] == READY_FOR_CANONICAL_CHUNK_V9
    ]
    downstream_eligible_records = [
        record
        for record in ready_records
        if bool(record.get("rag_consumption_eligible"))
        and bool(record.get("document_site_eligible"))
    ]
    recovery_records = [
        record
        for record in records
        if record["status"]
        in {
            NEEDS_OWNER_TEXT_RECOVERY,
            DUPLICATE_HOLD,
            EXCLUDED_BY_OPERATOR_POLICY,
            DEFER_WRAPPER_SUMMARY_BACKLOG,
        }
    ]
    return {
        "schema_version": HISTORICAL_REGULATION_DENOMINATOR_EXPANSION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_denominator_audit",
        "write_enabled": False,
        "batch_id": str(batch_config.get("batch_id") or ""),
        "target": "regulation",
        "scope": "historical_collected_notice_regulation_expansion",
        "input_notice_count": len(records),
        "completed_v9_overlap_count": sum(
            1 for record in records if record["source_notice_id"] in completed_ids
        ),
        "status_counts": dict(sorted(status_counts.items())),
        "source_shape_counts": dict(sorted(source_shape_counts.items())),
        "target_collection_counts": dict(sorted(target_collection_counts.items())),
        "ready_notice_ids": [str(record["source_notice_id"]) for record in ready_records],
        "downstream_eligible_notice_ids": [
            str(record["source_notice_id"]) for record in downstream_eligible_records
        ],
        "recovery_notice_ids": [str(record["source_notice_id"]) for record in recovery_records],
        "records": records,
        "policy": {
            "ready_status": READY_FOR_CANONICAL_CHUNK_V9,
            "downstream_consumption_eligible_collections": list(
                DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS
            ),
            "ready_requires": [
                "cohort_a_body_text_baseline",
                "body_text_source_shape",
                "not_wrapper_notice",
                "not_duplicate_hold",
                "not_operator_excluded",
                "not_known_incomplete_owner_policy",
                "not_already_completed_v9",
            ],
            "canonical_boundary": (
                "cleaning and normalization must happen in ingestion canonical "
                "materialization before document-units and chunk preparation"
            ),
            "stop_point": "canonical_document_units_chunk_quality_only",
        },
        "serving_closed_assertion": build_serving_closed_assertion(generated_at=timestamp),
        "candidate_store_noop_assertion": build_candidate_store_noop_assertion(
            generated_at=timestamp
        ),
    }


def _build_record(
    *,
    notice: Mapping[str, Any],
    cohort_a_ids: set[str],
    wrapper_ids: set[str],
    completed_ids: set[str],
) -> dict[str, Any]:
    notice_id = _required_text(notice.get("notice_id"), "notice_id")
    source_title = _required_text(notice.get("notice_title"), "notice_title")
    title = _effective_regulation_title(source_title)
    source_shape = str(notice.get("source_shape") or "").strip()
    status, reason_codes = _classify_notice(
        notice_id=notice_id,
        title=source_title,
        source_shape=source_shape,
        cohort_a_ids=cohort_a_ids,
        wrapper_ids=wrapper_ids,
        completed_ids=completed_ids,
    )
    target_collection = (
        _infer_target_collection(title=title) if status == READY_FOR_CANONICAL_CHUNK_V9 else ""
    )
    downstream_eligible = target_collection in DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS
    duplicate_survivor = DUPLICATE_SURVIVOR_BY_NOTICE_ID.get(notice_id, "")
    return {
        "source_notice_id": notice_id,
        "title": title,
        "source_title_literal": source_title,
        "source_shape": source_shape,
        "status": status,
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}" if target_collection else "",
        "document_site_eligible": downstream_eligible,
        "rag_consumption_eligible": downstream_eligible,
        "downstream_consumption_status": (
            "eligible_after_release_gate"
            if downstream_eligible
            else "chunk_only_non_serving"
            if target_collection == "scoped_rules"
            else "not_ready_for_downstream_consumption"
        ),
        "reason_codes": reason_codes,
        "duplicate_survivor_notice_id": duplicate_survivor,
        "already_in_completed_v9_cohort": notice_id in completed_ids,
        "query_serving_opened": False,
        "rag_release_opened": False,
        "embedding_opened": False,
        "index_release_opened": False,
        "alias_publish_opened": False,
    }


def _classify_notice(
    *,
    notice_id: str,
    title: str,
    source_shape: str,
    cohort_a_ids: set[str],
    wrapper_ids: set[str],
    completed_ids: set[str],
) -> tuple[str, list[str]]:
    reason_codes: list[str] = []
    if notice_id in completed_ids:
        return ALREADY_IN_COMPLETED_V9_COHORT, ["already_in_completed_v9_cohort"]
    if notice_id in OPERATOR_EXCLUDED_NOTICE_IDS:
        return EXCLUDED_BY_OPERATOR_POLICY, [OPERATOR_EXCLUDED_NOTICE_IDS[notice_id]]
    if notice_id in DUPLICATE_SURVIVOR_BY_NOTICE_ID:
        return DUPLICATE_HOLD, ["duplicate_source_notice_hold"]
    if source_shape in WRAPPER_SUMMARY_SOURCE_SHAPES:
        return DEFER_WRAPPER_SUMMARY_BACKLOG, ["wrapper_summary_not_owner_text"]
    if notice_id in wrapper_ids or source_shape in WRAPPER_SOURCE_SHAPES:
        return NEEDS_OWNER_TEXT_RECOVERY, ["wrapper_not_owner_text"]
    if notice_id in SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT:
        return NEEDS_OWNER_TEXT_RECOVERY, [
            SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT[notice_id]
        ]
    if notice_id in cohort_a_ids and source_shape in BODY_TEXT_SOURCE_SHAPES:
        reason_codes.append("cohort_a_body_text_owner_candidate")
        reason_codes.append("requires_v9_canonical_materialization")
        return READY_FOR_CANONICAL_CHUNK_V9, reason_codes
    if source_shape in BODY_TEXT_SOURCE_SHAPES:
        return NEEDS_OWNER_TEXT_RECOVERY, ["body_text_not_in_admitted_baseline"]
    return NEEDS_OWNER_TEXT_RECOVERY, ["unclassified_regulation_like_notice"]


def _infer_target_collection(*, title: str) -> str:
    if any(marker in title for marker in SCOPED_RULE_TITLE_MARKERS):
        return "scoped_rules"
    return "institutional_rules"


def _effective_regulation_title(title: str) -> str:
    for value in (_extract_quoted_title(title), title):
        cleaned = _strip_title_noise(value)
        if cleaned:
            return cleaned
    return _strip_title_noise(title)


def _extract_quoted_title(value: str) -> str:
    match = _QUOTE_TITLE_RE.search(value)
    return match.group(1).strip() if match is not None else ""


def _strip_title_noise(value: str) -> str:
    cleaned = str(value or "").strip()
    cleaned = re.sub(r"^\s*附件\s*\d*\s*[:：、.-]?\s*", "", cleaned)
    cleaned = re.sub(r"^重要通知[-—–_ ]*", "", cleaned)
    return cleaned.strip()


def _notice_rows(batch_config: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    rows = batch_config.get("notices")
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        return ()
    return tuple(row for row in rows if isinstance(row, Mapping))


def _cohort_notice_ids(cohort_manifest: Mapping[str, Any], cohort_id: str) -> set[str]:
    cohorts = cohort_manifest.get("cohorts")
    if not isinstance(cohorts, Mapping):
        return set()
    cohort = cohorts.get(cohort_id)
    if not isinstance(cohort, Mapping):
        return set()
    values = cohort.get("notice_ids")
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
        return set()
    return {str(value).strip() for value in values if str(value).strip()}


def _wrapper_notice_ids(wrapper_follow_up_manifest: Mapping[str, Any]) -> set[str]:
    values = wrapper_follow_up_manifest.get("wrapper_notice_ids")
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
        return set()
    return {str(value).strip() for value in values if str(value).strip()}


def _completed_source_notice_ids(admission_manifest: Mapping[str, Any]) -> set[str]:
    return {
        str(entry.get("source_notice_id") or "").strip()
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if str(entry.get("source_notice_id") or "").strip()
    }


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


__all__ = [
    "ALREADY_IN_COMPLETED_V9_COHORT",
    "DEFER_WRAPPER_SUMMARY_BACKLOG",
    "DUPLICATE_HOLD",
    "EXCLUDED_BY_OPERATOR_POLICY",
    "HISTORICAL_REGULATION_DENOMINATOR_EXPANSION_SCHEMA_VERSION",
    "NEEDS_OWNER_TEXT_RECOVERY",
    "READY_FOR_CANONICAL_CHUNK_V9",
    "build_historical_regulation_denominator_expansion_audit",
]
