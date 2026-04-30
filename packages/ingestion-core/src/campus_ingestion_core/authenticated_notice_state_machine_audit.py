from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_NONTERMINAL_STATUSES,
    MEDIA_LIFECYCLE_STATUSES,
    MEDIA_LIFECYCLE_TERMINAL_STATUSES,
)

AUDIT_SCHEMA_VERSION = "authenticated_notice_state_machine_audit.v1"

FINDING_HIGH = "high"
FINDING_MEDIUM = "medium"
FINDING_LOW = "low"

_FETCH_POLICIES = {
    "fetch_to_quarantine",
    "fetch_required_for_source_truth",
    "fetch_required_for_admitted_owner",
}


def build_authenticated_notice_state_machine_audit_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    fetch_request_manifest_path: Path | None = None,
) -> dict[str, Any]:
    searchable_notice_preview = _load_json_object(searchable_notice_preview_path)
    multimodal_candidate_inventory = _load_json_object(multimodal_candidate_inventory_path)
    fetch_request_manifest = (
        _load_json_object(fetch_request_manifest_path) if fetch_request_manifest_path else None
    )
    return build_authenticated_notice_state_machine_audit(
        searchable_notice_preview=searchable_notice_preview,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        fetch_request_manifest=fetch_request_manifest,
    )


def build_authenticated_notice_state_machine_audit(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    fetch_request_manifest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    units = tuple(_mapping_rows(searchable_notice_preview.get("units")))
    candidates = tuple(_mapping_rows(multimodal_candidate_inventory.get("candidates")))
    candidates_by_unit_id = _candidates_by_unit_id(candidates)
    fetch_requests = tuple(_mapping_rows((fetch_request_manifest or {}).get("requests")))
    unit_ids = {str(unit.get("unit_id") or "") for unit in units if str(unit.get("unit_id") or "")}

    matrix = [
        _matrix_row(unit, candidates_by_unit_id.get(str(unit.get("unit_id") or ""), ()))
        for unit in units
    ]
    findings: list[dict[str, Any]] = []
    for unit in units:
        findings.extend(
            _unit_findings(
                unit=unit,
                candidates=candidates_by_unit_id.get(str(unit.get("unit_id") or ""), ()),
            )
        )
    findings.extend(_global_candidate_findings(candidates=candidates, unit_ids=unit_ids))
    findings.extend(_fetch_manifest_findings(fetch_requests))
    findings = sorted(
        findings,
        key=lambda item: (
            _severity_rank(str(item["severity"])),
            str(item.get("source_notice_id") or ""),
            str(item.get("code") or ""),
        ),
    )
    return {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "unit_count": len(units),
        "candidate_count": len(candidates),
        "fetch_request_count": len(fetch_requests),
        "finding_count": len(findings),
        "finding_counts_by_severity": dict(
            sorted(Counter(str(item["severity"]) for item in findings).items())
        ),
        "finding_counts_by_code": dict(
            sorted(Counter(str(item["code"]) for item in findings).items())
        ),
        "unit_counts_by_surface": _count_by(matrix, "source_surface"),
        "unit_counts_by_route": _count_by(matrix, "primary_route"),
        "unit_counts_by_multimodal_status": _count_by(matrix, "multimodal_status"),
        "attachment_policy_counts": _sum_nested_counts(
            row["source_retention"].get("attachment_capture_policy_counts") for row in matrix
        ),
        "attachment_state_counts": _sum_nested_counts(
            row["source_retention"].get("attachment_capture_state_counts") for row in matrix
        ),
        "retention_class_counts": _sum_nested_counts(
            row["source_retention"].get("retention_class_counts") for row in matrix
        ),
        "matrix": matrix,
        "findings": findings,
        "verdict": "passed" if not _has_medium_or_high(findings) else "failed",
    }


def _matrix_row(
    unit: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    classification = dict(unit.get("classification") or {})
    source_retention = dict(unit.get("source_retention") or {})
    attachment_refs = tuple(_mapping_rows(unit.get("attachment_refs")))
    return {
        "source_surface": str(unit.get("source_surface") or ""),
        "source_notice_id": str(unit.get("source_notice_id") or ""),
        "title": str(unit.get("title") or ""),
        "primary_route": str(classification.get("primary_route") or ""),
        "target_candidates": list(classification.get("target_candidates") or ()),
        "multimodal_status": str(unit.get("multimodal_status") or ""),
        "reason_codes": list(unit.get("reason_codes") or ()),
        "source_retention": source_retention,
        "attachment_ref_count": len(attachment_refs),
        "candidate_count": len(candidates),
        "candidate_processing_families": dict(
            sorted(Counter(str(row.get("processing_family") or "") for row in candidates).items())
        ),
    }


def _unit_findings(
    *,
    unit: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    source_notice_id = str(unit.get("source_notice_id") or "")
    title = str(unit.get("title") or "")
    source_surface = str(unit.get("source_surface") or "")
    classification = dict(unit.get("classification") or {})
    primary_route = str(classification.get("primary_route") or "")
    target_candidates = tuple(str(item) for item in classification.get("target_candidates") or ())
    attachment_refs = tuple(_mapping_rows(unit.get("attachment_refs")))

    if unit.get("source_retention") is None:
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="missing_source_retention",
                source_notice_id=source_notice_id,
                title=title,
                detail="searchable unit is missing source_retention state",
            )
        )

    for attachment in attachment_refs:
        policy = str(attachment.get("attachment_capture_policy") or "")
        state = str(attachment.get("attachment_capture_state") or "")
        retention_class = str(attachment.get("retention_class") or "")
        ref_id = str(attachment.get("attachment_ref_id") or "")
        has_object_bytes = _has_object_bytes(attachment)
        if _is_terminal_unavailable_attachment(attachment):
            if (
                policy != "terminal_unavailable"
                or state != "terminal_missing"
                or retention_class != "metadata_only"
                or attachment.get("byte_fetch_required") is not False
                or bool(attachment.get("required_source_object"))
                or not str(attachment.get("terminal_reason") or "").strip()
            ):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="terminal_unavailable_state_mismatch",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail=(
                            "terminal_unavailable attachment must use terminal_missing, "
                            "metadata_only retention, byte_fetch_required=false, "
                            "required_source_object=false, and terminal_reason"
                        ),
                    )
                )
            if candidates:
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="terminal_attachment_generated_candidate",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="terminal_unavailable attachment must not generate media candidates",
                    )
                )
        if policy == "metadata_only":
            if candidates:
                findings.append(
                    _finding(
                        severity=FINDING_MEDIUM,
                        code="metadata_only_generated_multimodal_candidate",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="metadata_only attachment must not enter multimodal processing",
                    )
                )
            if state != "metadata_recorded" or retention_class != "metadata_only":
                findings.append(
                    _finding(
                        severity=FINDING_MEDIUM,
                        code="metadata_only_state_mismatch",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="metadata_only attachment has inconsistent state or retention class",
                    )
                )
        if policy == "fetch_to_quarantine" and has_object_bytes:  # noqa: SIM102
            if state != "uploaded_quarantine" or attachment.get("byte_fetch_required") is not False:
                findings.append(
                    _finding(
                        severity=FINDING_MEDIUM,
                        code="uploaded_quarantine_state_mismatch",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail=(
                            "captured quarantine attachment bytes must be uploaded_quarantine "
                            "with byte_fetch_required=false"
                        ),
                    )
                )
        if policy in {"fetch_required_for_source_truth", "fetch_required_for_admitted_owner"}:
            if has_object_bytes and state != "uploaded_required":
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="required_source_object_state_mismatch",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="required/admitted owner bytes must be uploaded_required",
                    )
                )
            if not bool(attachment.get("required_source_object")):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="required_policy_without_required_source_object",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="required/admitted fetch policy must set required_source_object=true",
                    )
                )

    if (
        source_surface == "notice"
        and primary_route == "notice_level_query"
        and not target_candidates
        and candidates
    ):
        findings.append(
            _finding(
                severity=FINDING_MEDIUM,
                code="notice_discover_only_generated_candidates",
                source_notice_id=source_notice_id,
                title=title,
                detail="notice-discover-only unit generated downstream multimodal candidates",
            )
        )
    for candidate in candidates:
        media_kind = str(candidate.get("media_kind") or "")
        processing_family = str(candidate.get("processing_family") or "")
        if media_kind == "pdf" and processing_family in {
            "internal_notice_multimodal",
            "multimodal_fallback",
        }:
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="pdf_candidate_uses_multimodal_fallback",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail=(
                        "pdf media must use text extraction or OCR-first processing before "
                        "multimodal fallback"
                    ),
                )
            )
        if media_kind == "office" and processing_family in {
            "internal_notice_multimodal",
            "multimodal_fallback",
        }:
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="office_candidate_uses_multimodal_fallback",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail="office media must use office text extraction before multimodal fallback",
                )
            )
        if str(candidate.get("status") or "") == "pending" and not candidate.get(
            "source_object_ref"
        ):
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="pending_candidate_missing_source_object_ref",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail="pending media extraction candidate must carry source_object_ref",
                )
            )
        findings.extend(
            _candidate_lifecycle_findings(
                candidate=candidate,
                source_notice_id=source_notice_id,
                title=title,
            )
        )
    return tuple(findings)


def _candidate_lifecycle_findings(
    *,
    candidate: Mapping[str, Any],
    source_notice_id: str,
    title: str,
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    candidate_id = str(candidate.get("candidate_id") or "")
    status = str(candidate.get("status") or "").strip()
    raw_target_blocking = candidate.get("target_blocking")
    target_blocking = raw_target_blocking if isinstance(raw_target_blocking, bool) else False
    if not isinstance(candidate.get("target_blocking"), bool):
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="candidate_target_blocking_not_boolean",
                source_notice_id=source_notice_id,
                title=title,
                detail="media extraction candidate target_blocking must be a boolean",
            )
        )
    if status == "failed":
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="legacy_candidate_status_failed",
                source_notice_id=source_notice_id,
                title=title,
                detail="candidate status must use failed_retryable or failed_terminal, not failed",
            )
        )
    elif status not in MEDIA_LIFECYCLE_STATUSES:
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="unsupported_candidate_status",
                source_notice_id=source_notice_id,
                title=title,
                detail=f"candidate has unsupported media lifecycle status: {status}",
            )
        )
    if target_blocking and not _candidate_has_source_object_ref(candidate):
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="target_blocking_candidate_missing_source_object_ref",
                source_notice_id=source_notice_id,
                title=title,
                detail="target_blocking media candidate must carry source_object_ref",
            )
        )
    if target_blocking and status in MEDIA_LIFECYCLE_TERMINAL_STATUSES:
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="terminal_candidate_still_target_blocking",
                source_notice_id=source_notice_id,
                title=title,
                detail="terminal media candidate must release target_blocking",
            )
        )
    if not target_blocking and status in MEDIA_LIFECYCLE_NONTERMINAL_STATUSES:
        media_role = str(candidate.get("media_role") or "")
        if media_role in {
            "owner_document",
            "schedule_table_carrier",
            "visual_text_only",
        }:
            findings.append(
                _finding(
                    severity=FINDING_MEDIUM,
                    code="nonterminal_required_media_not_target_blocking",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail=(
                        "nonterminal owner/schedule/status media candidate should be "
                        "target_blocking until closeout"
                    ),
                )
            )
    if not candidate_id:
        findings.append(
            _finding(
                severity=FINDING_HIGH,
                code="candidate_missing_id",
                source_notice_id=source_notice_id,
                title=title,
                detail="media extraction candidate is missing candidate_id",
            )
        )
    return tuple(findings)


def _global_candidate_findings(
    *,
    candidates: Sequence[Mapping[str, Any]],
    unit_ids: set[str],
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    seen_candidate_ids: set[str] = set()
    duplicate_candidate_ids: set[str] = set()
    for candidate in candidates:
        candidate_id = str(candidate.get("candidate_id") or "").strip()
        if candidate_id:
            if candidate_id in seen_candidate_ids and candidate_id not in duplicate_candidate_ids:
                duplicate_candidate_ids.add(candidate_id)
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="duplicate_candidate_id",
                        source_notice_id=str(candidate.get("source_notice_id") or ""),
                        title=str(candidate.get("title") or ""),
                        candidate_id=candidate_id,
                        detail="media extraction candidate inventory contains duplicate candidate_id",
                    )
                )
            seen_candidate_ids.add(candidate_id)

        unit_id = str(candidate.get("unit_id") or "").strip()
        if unit_id and unit_id not in unit_ids:
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="orphan_media_candidate",
                    source_notice_id=str(candidate.get("source_notice_id") or ""),
                    title=str(candidate.get("title") or ""),
                    candidate_id=candidate_id,
                    detail="media extraction candidate references a unit_id missing from searchable preview",
                )
            )
    return tuple(findings)


def _candidate_has_source_object_ref(candidate: Mapping[str, Any]) -> bool:
    source_ref = candidate.get("source_object_ref")
    if not isinstance(source_ref, Mapping):
        return False
    return bool(
        str(source_ref.get("bucket") or "").strip() and str(source_ref.get("key") or "").strip()
    )


def _fetch_manifest_findings(
    requests: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for request in requests:
        notice_id = str(request.get("notice_id") or "")
        ref_id = str(request.get("attachment_ref_id") or "")
        key = (notice_id, ref_id)
        if key in seen:
            findings.append(
                _finding(
                    severity=FINDING_MEDIUM,
                    code="duplicate_fetch_request",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest contains duplicate attachment request",
                )
            )
        seen.add(key)
        policy = str(request.get("attachment_capture_policy") or "")
        if (
            str(request.get("attachment_capture_state") or "") == "terminal_missing"
            or str(request.get("terminal_reason") or "").strip()
            or str(request.get("last_error_class") or "") == "terminal_unavailable"
            or policy == "terminal_unavailable"
        ):
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="fetch_request_for_terminal_attachment",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest must not request terminal_unavailable attachments",
                )
            )
        if policy not in _FETCH_POLICIES:
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="non_fetch_policy_in_manifest",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest contains a non-fetch policy",
                )
            )
    return tuple(findings)


def _finding(
    *,
    severity: str,
    code: str,
    source_notice_id: str,
    title: str,
    detail: str,
    attachment_ref_id: str | None = None,
    candidate_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "severity": severity,
        "code": code,
        "source_notice_id": source_notice_id,
        "title": title,
        "detail": detail,
    }
    if attachment_ref_id:
        payload["attachment_ref_id"] = attachment_ref_id
    if candidate_id:
        payload["candidate_id"] = candidate_id
    return payload


def _has_object_bytes(attachment: Mapping[str, Any]) -> bool:
    return bool(
        str(attachment.get("object_key") or "").strip()
        and str(attachment.get("content_sha256") or attachment.get("sha256") or "").strip()
        and str(attachment.get("storage_provider") or "").strip() != "reference_only"
        and str(attachment.get("ingest_status") or "").strip() in {"downloaded", "uploaded"}
    )


def _is_terminal_unavailable_attachment(attachment: Mapping[str, Any]) -> bool:
    return (
        str(attachment.get("attachment_capture_policy") or "") == "terminal_unavailable"
        or str(attachment.get("attachment_capture_state") or "") == "terminal_missing"
        or str(attachment.get("last_error_class") or "") == "terminal_unavailable"
        or bool(str(attachment.get("terminal_reason") or "").strip())
    )


def _candidates_by_unit_id(
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        grouped[str(candidate.get("unit_id") or "")].append(candidate)
    return {key: tuple(value) for key, value in grouped.items()}


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    return tuple(row for row in value or () if isinstance(row, Mapping))


def _load_json_object(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _count_by(rows: Sequence[Mapping[str, Any]], key: str) -> dict[str, int]:
    return dict(sorted(Counter(str(row.get(key) or "") for row in rows).items()))


def _sum_nested_counts(values: Sequence[object]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for value in values:
        if not isinstance(value, Mapping):
            continue
        for key, count in value.items():
            counts[str(key)] += int(count or 0)
    return dict(sorted(counts.items()))


def _severity_rank(severity: str) -> int:
    return {FINDING_HIGH: 0, FINDING_MEDIUM: 1, FINDING_LOW: 2}.get(severity, 3)


def _has_medium_or_high(findings: Sequence[Mapping[str, Any]]) -> bool:
    return any(
        str(item.get("severity") or "") in {FINDING_HIGH, FINDING_MEDIUM} for item in findings
    )


__all__ = [
    "AUDIT_SCHEMA_VERSION",
    "build_authenticated_notice_state_machine_audit",
    "build_authenticated_notice_state_machine_audit_from_paths",
]
