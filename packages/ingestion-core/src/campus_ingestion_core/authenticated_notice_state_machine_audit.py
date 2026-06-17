from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_NONTERMINAL_STATUSES,
    MEDIA_LIFECYCLE_STATUSES,
    MEDIA_LIFECYCLE_TERMINAL_STATUSES,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    candidate_has_source_object_ref as _candidate_has_source_object_ref,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    candidate_media_ref_id as _candidate_media_ref_id,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    candidate_source_ref_matches_attachment as _candidate_source_ref_matches_attachment,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    candidates_by_unit_id as _candidates_by_unit_id,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    candidates_for_attachment as _candidates_for_attachment,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    count_by as _count_by,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    fetch_manifest_findings as _fetch_manifest_findings,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    fetch_request_keys as _fetch_request_keys,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    finding as _finding,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    has_fetch_request as _has_fetch_request,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    has_medium_or_high as _has_medium_or_high,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    has_object_bytes as _has_object_bytes,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    is_skip_terminal_attachment as _is_skip_terminal_attachment,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    is_terminal_unavailable_attachment as _is_terminal_unavailable_attachment,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    load_json_object as _load_json_object,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    mapping_rows as _mapping_rows,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    severity_rank as _severity_rank,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    source_attachment_ref_index as _source_attachment_ref_index,
)
from campus_ingestion_core.authenticated_notice_state_machine_audit_support import (
    sum_nested_counts as _sum_nested_counts,
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
    fetch_request_keys = _fetch_request_keys(fetch_requests)
    source_ref_index = _source_attachment_ref_index(units)
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
                fetch_request_keys=fetch_request_keys,
            )
        )
    findings.extend(_global_candidate_findings(candidates=candidates, unit_ids=unit_ids))
    findings.extend(_fetch_manifest_findings(fetch_requests, source_ref_index=source_ref_index))
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
    fetch_request_keys: set[tuple[str, str, str]],
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    site_id = str(unit.get("site_id") or "")
    source_notice_id = str(unit.get("source_notice_id") or "")
    title = str(unit.get("title") or "")
    source_surface = str(unit.get("source_surface") or "")
    classification = dict(unit.get("classification") or {})
    primary_route = str(classification.get("primary_route") or "")
    target_candidates = tuple(str(item) for item in classification.get("target_candidates") or ())
    attachment_refs = tuple(_mapping_rows(unit.get("attachment_refs")))
    attachments_by_ref_id = {
        str(attachment.get("attachment_ref_id") or ""): attachment
        for attachment in attachment_refs
        if str(attachment.get("attachment_ref_id") or "")
    }
    has_single_attachment = len(attachment_refs) == 1

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
        attachment_candidates = _candidates_for_attachment(
            candidates,
            attachment_ref_id=ref_id,
            single_attachment=has_single_attachment,
        )
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
            if attachment_candidates:
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
        if _is_skip_terminal_attachment(attachment):
            if (
                state != "terminal_missing"
                or retention_class != "metadata_only"
                or attachment.get("byte_fetch_required") is not False
                or bool(attachment.get("required_source_object"))
                or not str(attachment.get("skip_reason") or "").strip()
            ):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="skip_terminal_state_mismatch",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail=(
                            "skip_unsupported/skip_too_large attachment must use terminal_missing, "
                            "metadata_only retention, byte_fetch_required=false, "
                            "required_source_object=false, and skip_reason"
                        ),
                    )
                )
            if attachment_candidates:
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="skip_terminal_generated_candidate",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail="skip terminal attachment must not generate media candidates",
                    )
                )
        if policy == "metadata_only":
            if attachment_candidates:
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
        if (
            policy in _FETCH_POLICIES
            and not has_object_bytes
            and not _is_terminal_unavailable_attachment(attachment)
            and not _is_skip_terminal_attachment(attachment)
            and attachment.get("byte_fetch_required") is True
            and not _has_fetch_request(
                fetch_request_keys,
                site_id=site_id,
                notice_id=source_notice_id,
                attachment_ref_id=ref_id,
            )
        ):
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="fetch_policy_missing_bytes_without_fetch_request",
                    source_notice_id=source_notice_id,
                    title=title,
                    attachment_ref_id=ref_id,
                    detail=(
                        "fetch policy attachment without bytes and byte_fetch_required=true "
                        "must appear in the fetch request manifest"
                    ),
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
                not has_object_bytes
                and not _is_terminal_unavailable_attachment(attachment)
                and attachment.get("byte_fetch_required") is not True
                and not _has_fetch_request(
                    fetch_request_keys,
                    site_id=site_id,
                    notice_id=source_notice_id,
                    attachment_ref_id=ref_id,
                )
            ):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="required_source_object_missing_bytes_without_fetch_request",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=ref_id,
                        detail=(
                            "required/admitted fetch policy without bytes must either keep "
                            "byte_fetch_required=true, emit a fetch request, or become typed terminal"
                        ),
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
        media_ref_id = _candidate_media_ref_id(candidate)
        if processing_family == "source_capture_repair":
            has_operator_action = bool(
                str(candidate.get("operator_action_id") or "").strip()
                or str(candidate.get("operator_action") or "").strip()
            )
            if not media_ref_id:
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="source_capture_repair_missing_media_ref",
                        source_notice_id=source_notice_id,
                        title=title,
                        candidate_id=str(candidate.get("candidate_id") or ""),
                        detail="source_capture_repair candidate must identify media_ref_id",
                    )
                )
            elif (
                not _has_fetch_request(
                    fetch_request_keys,
                    site_id=site_id,
                    notice_id=source_notice_id,
                    attachment_ref_id=media_ref_id,
                )
                and not has_operator_action
            ):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="source_capture_repair_without_fetch_request_or_operator_action",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=media_ref_id,
                        candidate_id=str(candidate.get("candidate_id") or ""),
                        detail=(
                            "source_capture_repair candidate must be closed by a fetch request "
                            "or an explicit operator action"
                        ),
                    )
                )
        if media_ref_id and (attachment := attachments_by_ref_id.get(media_ref_id)) is not None:
            source_object_ref = candidate.get("source_object_ref")
            if isinstance(
                source_object_ref, Mapping
            ) and not _candidate_source_ref_matches_attachment(
                source_object_ref=source_object_ref,
                attachment=attachment,
            ):
                findings.append(
                    _finding(
                        severity=FINDING_HIGH,
                        code="candidate_source_object_ref_missing_attachment_bytes",
                        source_notice_id=source_notice_id,
                        title=title,
                        attachment_ref_id=media_ref_id,
                        candidate_id=str(candidate.get("candidate_id") or ""),
                        detail=(
                            "candidate source_object_ref must match object-backed bytes on "
                            "the referenced attachment"
                        ),
                    )
                )
        if media_kind == "pdf" and processing_family == "internal_notice_multimodal":
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="pdf_candidate_uses_direct_multimodal_path",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail=(
                        "pdf media must use text extraction or OCR-first processing before "
                        "direct multimodal processing"
                    ),
                )
            )
        if media_kind == "office" and processing_family == "internal_notice_multimodal":
            findings.append(
                _finding(
                    severity=FINDING_HIGH,
                    code="office_candidate_uses_direct_multimodal_path",
                    source_notice_id=source_notice_id,
                    title=title,
                    detail="office media must use office text extraction before direct multimodal processing",
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


__all__ = [
    "AUDIT_SCHEMA_VERSION",
    "build_authenticated_notice_state_machine_audit",
    "build_authenticated_notice_state_machine_audit_from_paths",
]
