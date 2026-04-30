from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_COMPLETED,
    MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    MEDIA_LIFECYCLE_FAILED_TERMINAL,
    MEDIA_LIFECYCLE_MANUAL_REVIEW,
    MEDIA_LIFECYCLE_NONTERMINAL_STATUSES,
    MEDIA_LIFECYCLE_PENDING,
    MEDIA_LIFECYCLE_SKIPPED,
    normalize_media_lifecycle_status,
)

MEDIA_CLOSEOUT_STATE_MACHINE_AUDIT_SCHEMA_VERSION = (
    "notice_media_closeout_target_admission_state_machine_audit.v1"
)
FINDING_HIGH = "high"
FINDING_MEDIUM = "medium"
FINDING_LOW = "low"
_READY_CONSUMPTION_CLASSES = {
    "ready_for_target",
    "stage_ready",
    "downstream_admitted",
    "retained_for_notice_query",
}
_READY_TARGET_ADMISSION_STATES = {
    "stage_ready",
    "ready_for_target",
    "downstream_admitted",
}
_NONTERMINAL = {
    MEDIA_LIFECYCLE_PENDING,
    MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    MEDIA_LIFECYCLE_MANUAL_REVIEW,
}
_TERMINAL = {
    MEDIA_LIFECYCLE_COMPLETED,
    MEDIA_LIFECYCLE_SKIPPED,
    MEDIA_LIFECYCLE_FAILED_TERMINAL,
}


def build_collected_notice_media_closeout_state_machine_audit_from_paths(
    *,
    candidate_inventory_path: Path,
    attempt_ledger_path: Path | None = None,
    closeout_candidate_inventory_path: Path | None = None,
    target_admission_manifest_paths: Sequence[Path] = (),
    cleanup_report_path: Path | None = None,
    object_verification_report_path: Path | None = None,
    strict_gate: bool = True,
) -> dict[str, Any]:
    audit = build_collected_notice_media_closeout_state_machine_audit(
        candidate_inventory=_load_json_object(candidate_inventory_path),
        attempt_ledger=_load_json_object(attempt_ledger_path) if attempt_ledger_path else None,
        closeout_candidate_inventory=(
            _load_json_object(closeout_candidate_inventory_path)
            if closeout_candidate_inventory_path
            else None
        ),
        target_admission_manifests=[
            _load_json_object(path) for path in target_admission_manifest_paths
        ],
        cleanup_report=_load_json_object(cleanup_report_path) if cleanup_report_path else None,
        object_verification_report=(
            _load_json_object(object_verification_report_path)
            if object_verification_report_path
            else None
        ),
        strict_gate=strict_gate,
    )
    input_hashes = {"candidate_inventory_sha256": _sha256_file(candidate_inventory_path)}
    if attempt_ledger_path:
        input_hashes["attempt_ledger_sha256"] = _sha256_file(attempt_ledger_path)
    if closeout_candidate_inventory_path:
        input_hashes["closeout_candidate_inventory_sha256"] = _sha256_file(
            closeout_candidate_inventory_path
        )
    if cleanup_report_path:
        input_hashes["cleanup_report_sha256"] = _sha256_file(cleanup_report_path)
    if object_verification_report_path:
        input_hashes["object_verification_report_sha256"] = _sha256_file(
            object_verification_report_path
        )
    for index, path in enumerate(target_admission_manifest_paths, start=1):
        input_hashes[f"target_admission_manifest_{index}_sha256"] = _sha256_file(path)
    audit["input_hashes"] = input_hashes
    return audit


def build_collected_notice_media_closeout_state_machine_audit(
    *,
    candidate_inventory: Mapping[str, Any],
    attempt_ledger: Mapping[str, Any] | None = None,
    closeout_candidate_inventory: Mapping[str, Any] | None = None,
    target_admission_manifests: Sequence[Mapping[str, Any]] = (),
    cleanup_report: Mapping[str, Any] | None = None,
    object_verification_report: Mapping[str, Any] | None = None,
    strict_gate: bool = True,
) -> dict[str, Any]:
    candidates = tuple(
        _canonical_candidate(row) for row in _mapping_rows(candidate_inventory.get("candidates"))
    )
    closeout_candidates = tuple(
        _canonical_candidate(row)
        for row in _mapping_rows((closeout_candidate_inventory or {}).get("candidates"))
    )
    attempts = tuple(
        _canonical_attempt(row) for row in _mapping_rows((attempt_ledger or {}).get("attempts"))
    )
    candidates_by_id = {
        str(candidate.get("candidate_id") or ""): candidate for candidate in candidates
    }
    attempts_by_candidate = _attempts_by_candidate(attempts)
    findings: list[dict[str, Any]] = []
    findings.extend(
        _strict_gate_findings(
            strict_gate=strict_gate,
            attempt_ledger=attempt_ledger,
            closeout_candidate_inventory=closeout_candidate_inventory,
            target_admission_manifests=target_admission_manifests,
            cleanup_report=cleanup_report,
            object_verification_report=object_verification_report,
        )
    )
    findings.extend(_candidate_attempt_findings(candidates, attempts_by_candidate))
    findings.extend(_attempt_findings(attempts, candidates_by_id=candidates_by_id))
    findings.extend(
        _closeout_findings(
            closeout_candidates,
            attempts_by_candidate=attempts_by_candidate,
            candidates_by_id=candidates_by_id,
        )
    )
    findings.extend(
        _target_admission_findings(
            candidates=closeout_candidates or candidates,
            target_admission_manifests=target_admission_manifests,
            strict_gate=strict_gate,
        )
    )
    findings.extend(
        _cleanup_findings(
            candidates=closeout_candidates or candidates, cleanup_report=cleanup_report
        )
    )
    findings.extend(
        _object_verification_findings(
            candidates=candidates,
            object_verification_report=object_verification_report,
        )
    )
    findings = sorted(
        findings,
        key=lambda item: (
            _severity_rank(str(item["severity"])),
            str(item.get("candidate_id") or ""),
            str(item.get("code") or ""),
        ),
    )
    return {
        "schema_version": MEDIA_CLOSEOUT_STATE_MACHINE_AUDIT_SCHEMA_VERSION,
        "candidate_count": len(candidates),
        "closeout_candidate_count": len(closeout_candidates),
        "attempt_count": len(attempts),
        "finding_count": len(findings),
        "finding_counts_by_severity": dict(
            sorted(Counter(str(item["severity"]) for item in findings).items())
        ),
        "finding_counts_by_code": dict(
            sorted(Counter(str(item["code"]) for item in findings).items())
        ),
        "candidate_counts_by_status": dict(
            sorted(Counter(str(item.get("status") or "") for item in candidates).items())
        ),
        "attempt_counts_by_status": dict(
            sorted(Counter(str(item.get("status") or "") for item in attempts).items())
        ),
        "strict_gate": strict_gate,
        "findings": findings,
        "verdict": "passed" if not _has_medium_or_high(findings) else "failed",
    }


def _strict_gate_findings(
    *,
    strict_gate: bool,
    attempt_ledger: Mapping[str, Any] | None,
    closeout_candidate_inventory: Mapping[str, Any] | None,
    target_admission_manifests: Sequence[Mapping[str, Any]],
    cleanup_report: Mapping[str, Any] | None,
    object_verification_report: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if not strict_gate:
        return []
    findings: list[dict[str, Any]] = []
    if attempt_ledger is None:
        findings.append(
            _system_finding(
                FINDING_HIGH,
                "strict_gate_missing_attempt_ledger",
                "strict media closeout gate requires an attempt ledger",
            )
        )
    if closeout_candidate_inventory is None:
        findings.append(
            _system_finding(
                FINDING_HIGH,
                "strict_gate_missing_closeout_candidate_inventory",
                "strict media closeout gate requires a closeout candidate inventory",
            )
        )
    if not target_admission_manifests:
        findings.append(
            _system_finding(
                FINDING_HIGH,
                "strict_gate_missing_target_admission_manifest",
                "strict media closeout gate requires target admission manifest evidence",
            )
        )
    if cleanup_report is None:
        findings.append(
            _system_finding(
                FINDING_HIGH,
                "strict_gate_missing_cleanup_report",
                "strict media closeout gate requires cleanup dry-run evidence",
            )
        )
    if object_verification_report is None:
        findings.append(
            _system_finding(
                FINDING_HIGH,
                "strict_gate_missing_object_verification_report",
                "strict media closeout gate requires source-object verification evidence",
            )
        )
    return findings


def _candidate_attempt_findings(
    candidates: Sequence[Mapping[str, Any]],
    attempts_by_candidate: Mapping[str, Sequence[Mapping[str, Any]]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for candidate in candidates:
        candidate_id = str(candidate.get("candidate_id") or "")
        if (
            bool(candidate.get("target_blocking"))
            and _status(candidate) in MEDIA_LIFECYCLE_NONTERMINAL_STATUSES
            and not attempts_by_candidate.get(candidate_id)
        ):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "target_blocking_candidate_without_attempt_ledger",
                    candidate,
                    "target-blocking nonterminal candidate must have an attempt ledger row",
                )
            )
    return findings


def _attempt_findings(
    attempts: Sequence[Mapping[str, Any]],
    *,
    candidates_by_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for attempt in attempts:
        status = _status(attempt)
        candidate_id = str(attempt.get("candidate_id") or "")
        candidate = candidates_by_id.get(candidate_id)
        if candidate is None:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "attempt_without_candidate",
                    attempt,
                    "attempt ledger row must refer to a candidate inventory row",
                )
            )
            continue
        findings.extend(_attempt_candidate_consistency_findings(attempt, candidate))
        if status == MEDIA_LIFECYCLE_FAILED_RETRYABLE:
            retry_budget = _int(attempt.get("retry_budget_remaining"))
            if retry_budget <= 0 or not str(attempt.get("next_retry_after") or "").strip():
                findings.append(
                    _finding(
                        FINDING_HIGH,
                        "failed_retryable_attempt_without_retry_budget",
                        candidate,
                        "failed_retryable attempt must carry retry budget and next retry time",
                    )
                )
        if (
            status == MEDIA_LIFECYCLE_MANUAL_REVIEW
            and not str(attempt.get("manual_review_reason") or "").strip()
        ):
            findings.append(
                _finding(
                    FINDING_MEDIUM,
                    "manual_review_attempt_without_reason",
                    candidate,
                    "manual_review attempt must carry manual_review_reason",
                )
            )
        if (
            status == MEDIA_LIFECYCLE_FAILED_TERMINAL
            and not str(attempt.get("terminal_reason") or "").strip()
        ):
            findings.append(
                _finding(
                    FINDING_MEDIUM,
                    "failed_terminal_attempt_without_reason",
                    candidate,
                    "failed_terminal attempt must carry terminal_reason",
                )
            )
        if status == MEDIA_LIFECYCLE_COMPLETED and not _has_output_refs(attempt):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "completed_attempt_without_output_refs",
                    candidate,
                    "completed attempt must carry output refs",
                )
            )
    return findings


def _attempt_candidate_consistency_findings(
    attempt: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for field in ("unit_id", "source_notice_id", "media_ref_id"):
        attempt_value = str(attempt.get(field) or "").strip()
        candidate_value = str(candidate.get(field) or "").strip()
        if attempt_value and candidate_value and attempt_value != candidate_value:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    f"attempt_{field}_mismatch",
                    attempt,
                    f"attempt {field} must match candidate {field}",
                )
            )
    if _object_ref_identity(attempt) != _object_ref_identity(candidate):
        findings.append(
            _finding(
                FINDING_HIGH,
                "attempt_source_object_ref_mismatch",
                attempt,
                "attempt source_object_ref bucket/key must match candidate source_object_ref",
            )
        )
    if (
        _source_hash(attempt)
        and _source_hash(candidate)
        and _source_hash(attempt) != _source_hash(candidate)
    ):
        findings.append(
            _finding(
                FINDING_HIGH,
                "attempt_source_object_hash_mismatch",
                attempt,
                "attempt source object hash must match candidate source object hash",
            )
        )
    if _status(attempt) in _NONTERMINAL and bool(candidate.get("target_blocking")):
        if not _object_ref_identity(attempt):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "nonterminal_blocking_attempt_without_source_object_ref",
                    attempt,
                    "nonterminal target-blocking attempt must carry source object ref",
                )
            )
        if not _source_hash(attempt):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "nonterminal_blocking_attempt_without_source_object_hash",
                    attempt,
                    "nonterminal target-blocking attempt must carry source object hash",
                )
            )
    return findings


def _closeout_findings(
    candidates: Sequence[Mapping[str, Any]],
    *,
    attempts_by_candidate: Mapping[str, Sequence[Mapping[str, Any]]],
    candidates_by_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for candidate in candidates:
        status = _status(candidate)
        if status == MEDIA_LIFECYCLE_COMPLETED and not _has_output_refs(candidate):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "completed_closeout_candidate_without_output_refs",
                    candidate,
                    "completed closeout candidate must carry completed output refs",
                )
            )
        if status == MEDIA_LIFECYCLE_COMPLETED and not any(
            _status(attempt) == MEDIA_LIFECYCLE_COMPLETED
            for attempt in attempts_by_candidate.get(str(candidate.get("candidate_id") or ""), ())
        ):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "completed_closeout_without_completed_attempt",
                    candidate,
                    "completed closeout candidate must be backed by a completed attempt",
                )
            )
        if (
            status == MEDIA_LIFECYCLE_COMPLETED
            and _has_output_refs(candidate)
            and not _closeout_attempt_provenance(candidate)
        ):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "completed_closeout_without_attempt_provenance",
                    candidate,
                    "completed closeout candidate must record attempt_id or attempt_number provenance",
                )
            )
        completed_attempts = tuple(
            attempt
            for attempt in attempts_by_candidate.get(str(candidate.get("candidate_id") or ""), ())
            if _status(attempt) == MEDIA_LIFECYCLE_COMPLETED
        )
        if (
            status == MEDIA_LIFECYCLE_COMPLETED
            and _has_output_refs(candidate)
            and completed_attempts
            and _closeout_attempt_provenance(candidate)
            and not _closeout_attempt_provenance_matches(candidate, completed_attempts)
        ):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "completed_closeout_attempt_provenance_mismatch",
                    candidate,
                    "completed closeout attempt provenance must match a completed attempt",
                )
            )
        source_candidate = candidates_by_id.get(str(candidate.get("candidate_id") or ""))
        if source_candidate is not None and _object_ref_identity(candidate) != _object_ref_identity(
            source_candidate
        ):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "closeout_source_object_ref_mismatch",
                    candidate,
                    "closeout candidate source object ref must match source candidate",
                )
            )
        if status in _TERMINAL and bool(candidate.get("target_blocking")):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "terminal_closeout_candidate_still_target_blocking",
                    candidate,
                    "terminal closeout candidate must release target_blocking",
                )
            )
    return findings


def _target_admission_findings(
    *,
    candidates: Sequence[Mapping[str, Any]],
    target_admission_manifests: Sequence[Mapping[str, Any]],
    strict_gate: bool,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    blockers_by_unit: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    candidates_by_unit: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        candidates_by_unit[str(candidate.get("unit_id") or "")].append(candidate)
        if bool(candidate.get("target_blocking")) and _status(candidate) in _NONTERMINAL:
            blockers_by_unit[str(candidate.get("unit_id") or "")].append(candidate)
    for manifest in target_admission_manifests:
        for entry in _mapping_rows(manifest.get("entries")):
            unit_id = str(
                entry.get("searchable_unit_id")
                or entry.get("unit_id")
                or entry.get("entry_id")
                or ""
            )
            consumption_class = str(entry.get("consumption_class") or "").strip()
            target_admission_state = str(entry.get("target_admission_state") or "").strip()
            if (
                consumption_class in _READY_CONSUMPTION_CLASSES
                or target_admission_state in _READY_TARGET_ADMISSION_STATES
            ) and blockers_by_unit.get(unit_id):
                findings.append(
                    _finding(
                        FINDING_HIGH,
                        "target_admission_ready_with_nonterminal_blocker",
                        blockers_by_unit[unit_id][0],
                        "target admission cannot be ready while target-blocking media is nonterminal",
                    )
                )
            if strict_gate and candidates_by_unit.get(unit_id):
                candidate_for_entry = candidates_by_unit[unit_id][0]
                if not str(entry.get("fact_readiness_state") or "").strip():
                    findings.append(
                        _finding(
                            FINDING_HIGH,
                            "target_admission_manifest_missing_fact_readiness_state",
                            candidate_for_entry,
                            "target admission manifest must carry fact_readiness_state",
                        )
                    )
                required_fact_groups = entry.get("required_fact_groups")
                if not (
                    isinstance(required_fact_groups, list | tuple)
                    and any(str(item).strip() for item in required_fact_groups)
                ):
                    findings.append(
                        _finding(
                            FINDING_HIGH,
                            "target_admission_manifest_missing_required_fact_groups",
                            candidate_for_entry,
                            "target admission manifest must carry required_fact_groups",
                        )
                    )
            for candidate in candidates_by_unit.get(unit_id, ()):
                entry_target = str(entry.get("target") or "").strip()
                if entry_target and entry_target not in _candidate_targets(candidate):
                    findings.append(
                        _finding(
                            FINDING_HIGH,
                            "target_admission_manifest_target_mismatch",
                            candidate,
                            "target admission manifest target must match candidate target hints",
                        )
                    )
                source_notice_id = str(entry.get("source_notice_id") or "").strip()
                if (
                    source_notice_id
                    and source_notice_id != str(candidate.get("source_notice_id") or "").strip()
                ):
                    findings.append(
                        _finding(
                            FINDING_HIGH,
                            "target_admission_manifest_source_notice_mismatch",
                            candidate,
                            "target admission manifest source_notice_id must match candidate",
                        )
                    )
    if strict_gate and target_admission_manifests:
        manifest_unit_ids = {
            str(
                entry.get("searchable_unit_id")
                or entry.get("unit_id")
                or entry.get("entry_id")
                or ""
            )
            for manifest in target_admission_manifests
            for entry in _mapping_rows(manifest.get("entries"))
        }
        manifest_unit_ids.discard("")
        for candidate in candidates:
            unit_id = str(candidate.get("unit_id") or "")
            if unit_id and unit_id not in manifest_unit_ids:
                findings.append(
                    _finding(
                        FINDING_HIGH,
                        "target_admission_manifest_missing_candidate_unit",
                        candidate,
                        "target admission manifest must include every media candidate unit",
                    )
                )
    return findings


def _cleanup_findings(
    *,
    candidates: Sequence[Mapping[str, Any]],
    cleanup_report: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if cleanup_report is None:
        return []
    active_refs = {
        _object_ref_identity(candidate)
        for candidate in candidates
        if bool(candidate.get("target_blocking")) and _status(candidate) in _NONTERMINAL
    }
    active_refs.discard(None)
    findings: list[dict[str, Any]] = []
    selected_refs: set[tuple[str, str] | None] = set()
    for row in _cleanup_selected_rows(cleanup_report):
        object_ref = _cleanup_object_identity(row)
        if object_ref:
            selected_refs.add(object_ref)
        if object_ref in active_refs:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "cleanup_selected_active_blocking_quarantine_object",
                    {
                        "candidate_id": "",
                        "source_object_ref": {
                            "bucket": object_ref[0] if object_ref else "",
                            "key": object_ref[1] if object_ref else "",
                        },
                    },
                    "cleanup dry-run selected an object still blocked by active media candidate",
                )
            )
    protected_refs = _cleanup_protected_refs(cleanup_report)
    for object_ref in sorted(active_refs - selected_refs - protected_refs):
        if object_ref is None:
            continue
        findings.append(
            _finding(
                FINDING_HIGH,
                "cleanup_report_missing_active_blocking_quarantine_object",
                {
                    "candidate_id": "",
                    "source_object_ref": {"bucket": object_ref[0], "key": object_ref[1]},
                },
                "cleanup dry-run must explicitly protect active blocking quarantine object",
            )
        )
    return findings


def _object_verification_findings(
    *,
    candidates: Sequence[Mapping[str, Any]],
    object_verification_report: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if object_verification_report is None:
        return []
    verified_rows = {
        _object_ref_identity(row): row
        for row in _mapping_rows(object_verification_report.get("rows"))
        if _object_ref_identity(row)
    }
    findings: list[dict[str, Any]] = []
    for candidate in candidates:
        identity = _object_ref_identity(candidate)
        if not identity:
            continue
        verified = verified_rows.get(identity)
        if verified is None or str(verified.get("status") or "").strip() != "verified":
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_not_verified",
                    candidate,
                    "candidate source_object_ref must be verified before live execution gate",
                )
            )
            continue
        if _is_reference_only_object(verified):
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_verified_as_reference_only",
                    candidate,
                    "candidate source object verification must not be reference_only",
                )
            )
        if _storage_provider(verified) in {"", "reference_only"}:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_invalid_storage_provider",
                    candidate,
                    "candidate source object verification must carry object-backed storage provider",
                )
            )
        check_method = str(verified.get("check_method") or "").strip()
        if check_method not in {"head_checksum", "get_hash"}:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_not_live_checked",
                    candidate,
                    "candidate source object verification must be backed by live HEAD checksum or GET hash",
                )
            )
        if not str(verified.get("live_checked_at") or "").strip():
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_live_checked_at",
                    candidate,
                    "candidate source object verification must record live_checked_at",
                )
            )
        candidate_hash = _source_hash(candidate)
        verified_hash = _source_hash(verified)
        if not candidate_hash or not verified_hash:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_hash",
                    candidate,
                    "candidate source object verification must carry candidate and verified hash",
                )
            )
        elif candidate_hash != verified_hash:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_hash_mismatch",
                    candidate,
                    "candidate source object verification hash must match candidate source hash",
                )
            )
        candidate_size = _byte_size(candidate)
        verified_size = _byte_size(verified)
        if candidate_size <= 0 or verified_size <= 0:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_verification_missing_size",
                    candidate,
                    "candidate source object verification must carry candidate and verified byte size",
                )
            )
        elif candidate_size != verified_size:
            findings.append(
                _finding(
                    FINDING_HIGH,
                    "candidate_source_object_size_mismatch",
                    candidate,
                    "candidate source object verification byte size must match candidate source byte size",
                )
            )
    return findings


def _cleanup_selected_rows(cleanup_report: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    rows: list[Mapping[str, Any]] = []
    for key in (
        "dry_run_objects",
        "deleted_objects",
        "dry_run_rows",
        "deleted_rows",
        "candidates",
    ):
        rows.extend(_mapping_rows(cleanup_report.get(key)))
    return tuple(rows)


def _cleanup_protected_refs(cleanup_report: Mapping[str, Any]) -> set[tuple[str, str]]:
    rows: list[Mapping[str, Any]] = []
    for key in (
        "blocked_quarantine_objects",
        "protected_objects",
        "retained_objects",
        "skipped_active_objects",
    ):
        rows.extend(_mapping_rows(cleanup_report.get(key)))
    return {ref for row in rows if (ref := _cleanup_object_identity(row))}


def _cleanup_object_key(row: Mapping[str, Any]) -> str:
    return str(row.get("object_key") or row.get("key") or "").strip()


def _cleanup_object_identity(row: Mapping[str, Any]) -> tuple[str, str] | None:
    bucket = str(row.get("bucket") or "").strip()
    key = _cleanup_object_key(row)
    if not bucket or not key:
        return None
    return (bucket, key)


def _object_key(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if not isinstance(source_ref, Mapping):
        return ""
    return str(source_ref.get("key") or "").strip()


def _object_bucket(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        return str(source_ref.get("bucket") or "").strip()
    return str(row.get("bucket") or "").strip()


def _object_ref_identity(row: Mapping[str, Any]) -> tuple[str, str] | None:
    bucket = _object_bucket(row)
    key = _object_key(row) or str(row.get("object_key") or row.get("key") or "").strip()
    if not bucket or not key:
        return None
    return (bucket, key)


def _source_hash(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        value = source_ref.get("sha256") or source_ref.get("content_sha256")
        if value:
            return str(value).strip()
    return str(
        row.get("source_object_hash")
        or row.get("sha256")
        or row.get("content_sha256")
        or row.get("expected_sha256")
        or ""
    ).strip()


def _byte_size(row: Mapping[str, Any]) -> int:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        size = _int(source_ref.get("byte_size") or source_ref.get("size"))
        if size > 0:
            return size
    return _int(row.get("byte_size") or row.get("size") or row.get("expected_byte_size"))


def _storage_provider(row: Mapping[str, Any]) -> str:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping):
        value = source_ref.get("storage_provider")
        if value:
            return str(value).strip()
    return str(row.get("storage_provider") or "").strip()


def _is_reference_only_object(row: Mapping[str, Any]) -> bool:
    source_ref = row.get("source_object_ref")
    if isinstance(source_ref, Mapping) and isinstance(source_ref.get("reference_only"), bool):
        return bool(source_ref.get("reference_only"))
    return bool(row.get("reference_only"))


def _has_output_refs(row: Mapping[str, Any]) -> bool:
    for key in ("completed_output_refs", "output_refs", "written_refs"):
        value = row.get(key)
        if isinstance(value, Mapping) and value:
            return True
    return False


def _closeout_attempt_provenance(row: Mapping[str, Any]) -> bool:
    closeout = row.get("closeout")
    if isinstance(closeout, Mapping) and (
        str(closeout.get("attempt_id") or "").strip()
        or str(closeout.get("attempt_number") or "").strip()
    ):
        return True
    return bool(
        str(row.get("attempt_id") or "").strip() or str(row.get("attempt_number") or "").strip()
    )


def _closeout_attempt_provenance_matches(
    row: Mapping[str, Any],
    attempts: Sequence[Mapping[str, Any]],
) -> bool:
    attempt_id, attempt_number = _closeout_attempt_identity(row)
    for attempt in attempts:
        if _status(attempt) != MEDIA_LIFECYCLE_COMPLETED:
            continue
        if attempt_id and attempt_id == str(attempt.get("attempt_id") or "").strip():
            return True
        if attempt_number is not None and attempt_number == _int(attempt.get("attempt_number")):
            return True
    return False


def _closeout_attempt_identity(row: Mapping[str, Any]) -> tuple[str, int | None]:
    closeout = row.get("closeout")
    if isinstance(closeout, Mapping):
        attempt_id = str(closeout.get("attempt_id") or "").strip()
        attempt_number = _positive_int_or_none(closeout.get("attempt_number"))
        if attempt_id or attempt_number is not None:
            return attempt_id, attempt_number
    return (
        str(row.get("attempt_id") or "").strip(),
        _positive_int_or_none(row.get("attempt_number")),
    )


def _positive_int_or_none(value: object) -> int | None:
    parsed = _int(value)
    return parsed if parsed > 0 else None


def _candidate_targets(candidate: Mapping[str, Any]) -> set[str]:
    values = {
        str(value).strip() for value in candidate.get("target_hints") or () if str(value).strip()
    }
    value = str(candidate.get("target") or "").strip()
    if value:
        values.add(value)
    return values or {"unknown"}


def _canonical_candidate(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["status"] = _status(payload)
    return payload


def _canonical_attempt(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["status"] = _status(payload)
    return payload


def _status(row: Mapping[str, Any]) -> str:
    return normalize_media_lifecycle_status(row.get("status") or row.get("media_text_status"))


def _attempts_by_candidate(
    attempts: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        grouped[str(attempt.get("candidate_id") or "")].append(attempt)
    return {key: tuple(value) for key, value in grouped.items()}


def _int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _finding(
    severity: str,
    code: str,
    row: Mapping[str, Any],
    detail: str,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "candidate_id": str(row.get("candidate_id") or ""),
        "unit_id": str(row.get("unit_id") or ""),
        "source_notice_id": str(row.get("source_notice_id") or ""),
        "media_ref_id": str(row.get("media_ref_id") or ""),
        "source_object_key": _object_key(row),
        "detail": detail,
    }


def _system_finding(severity: str, code: str, detail: str) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "candidate_id": "",
        "unit_id": "",
        "source_notice_id": "",
        "media_ref_id": "",
        "source_object_key": "",
        "detail": detail,
    }


def _has_medium_or_high(findings: Sequence[Mapping[str, Any]]) -> bool:
    return any(str(row.get("severity") or "") in {FINDING_HIGH, FINDING_MEDIUM} for row in findings)


def _severity_rank(value: str) -> int:
    return {FINDING_HIGH: 0, FINDING_MEDIUM: 1, FINDING_LOW: 2}.get(value, 99)


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _load_json_object(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


__all__ = [
    "MEDIA_CLOSEOUT_STATE_MACHINE_AUDIT_SCHEMA_VERSION",
    "build_collected_notice_media_closeout_state_machine_audit",
    "build_collected_notice_media_closeout_state_machine_audit_from_paths",
]
