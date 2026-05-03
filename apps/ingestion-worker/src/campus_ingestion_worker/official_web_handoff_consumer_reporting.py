from __future__ import annotations

import os
from pathlib import Path

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    coerce_non_negative_int,
    count_by_value,
    load_manifest_hosts,
    normalize_string_list,
    optional_text,
    require_object_list,
    require_text,
)
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    _PROMOTION_DISALLOWED_PAGE_FAMILIES,
    HttpOfficialWebExecutionStatusReporter,
    OfficialWebExecutionStatusReporter,
    OfficialWebHandoffConsumerSettings,
)


def build_stage_quality_report(
    *,
    settings: OfficialWebHandoffConsumerSettings,
    payload: dict[str, object],
    replay_input_dir: Path,
    replay_report: dict[str, object],
    chunk_audit_report: dict[str, object],
) -> dict[str, object]:
    seed_set = normalize_string_list(payload.get("seedSet"))
    expected_host_set = normalize_string_list(payload.get("hostSet"))
    actual_host_set = sorted(load_manifest_hosts(replay_input_dir))
    replay_counts = (
        replay_report.get("counts") if isinstance(replay_report.get("counts"), dict) else {}
    )
    pages_seen = coerce_non_negative_int(replay_counts.get("pages_seen"))
    emitted_documents = coerce_non_negative_int(replay_counts.get("emitted_documents"))
    manual_review_pages = coerce_non_negative_int(replay_counts.get("manual_review_pages"))
    chunk_audit_passed = bool(chunk_audit_report.get("passed"))
    replay_documents = require_object_list(replay_report.get("documents"), "documents")
    document_page_family_counts = count_by_value(
        require_text(document.get("page_family"), "page_family") for document in replay_documents
    )
    document_serving_intent_counts = count_by_value(
        require_text(document.get("serving_intent") or "unknown", "serving_intent")
        for document in replay_documents
    )
    target_family_counts = _int_mapping(replay_report.get("target_family_counts"))
    target_materialization_policy_counts = _int_mapping(
        replay_report.get("target_materialization_policy_counts")
    )
    target_lineage_issues = require_object_list(
        replay_report.get("target_lineage_issues") or [],
        "target_lineage_issues",
    )
    manual_review_page_family_counts = count_by_value(
        require_text(page.get("page_family"), "page_family")
        for page in require_object_list(
            replay_report.get("manual_review_pages"), "manual_review_pages"
        )
    )
    seed_coverage_ratio = round(pages_seen / len(seed_set), 4) if seed_set else 1.0
    host_coverage_ratio = (
        round(len(actual_host_set) / len(expected_host_set), 4) if expected_host_set else 1.0
    )
    blocked_checks: list[dict[str, object]] = []
    checks: list[dict[str, object]] = []

    def record_check(
        *,
        code: str,
        passed: bool,
        message: str,
        actual: object,
        expected: object,
    ) -> None:
        check = {
            "code": code,
            "passed": passed,
            "message": message,
            "actual": actual,
            "expected": expected,
        }
        checks.append(check)
        if not passed:
            blocked_checks.append(check)

    record_check(
        code="minimum_promote_pages",
        passed=pages_seen >= settings.minimum_promote_pages,
        message="source-truth bundle must contain enough pages before promotion",
        actual=pages_seen,
        expected={"min": settings.minimum_promote_pages},
    )
    record_check(
        code="seed_coverage_ratio",
        passed=seed_coverage_ratio >= settings.minimum_seed_coverage_ratio,
        message="seed coverage ratio is below the promotion threshold",
        actual=seed_coverage_ratio,
        expected={"min": settings.minimum_seed_coverage_ratio},
    )
    record_check(
        code="host_coverage_ratio",
        passed=host_coverage_ratio >= settings.minimum_host_coverage_ratio,
        message="host coverage ratio is below the promotion threshold",
        actual=host_coverage_ratio,
        expected={"min": settings.minimum_host_coverage_ratio},
    )
    record_check(
        code="emitted_documents_present",
        passed=emitted_documents > 0,
        message="projection replay emitted no promotable documents",
        actual=emitted_documents,
        expected={"min": 1},
    )
    promotable_document_count = sum(
        1
        for document in replay_documents
        if require_text(document.get("serving_intent") or "unknown", "serving_intent")
        == "promotable"
    )
    record_check(
        code="promotable_documents_present",
        passed=promotable_document_count > 0,
        message="projection replay emitted no promotable documents after staged-only filtering",
        actual=promotable_document_count,
        expected={"min": 1},
    )
    record_check(
        code="chunk_audit_passed",
        passed=chunk_audit_passed,
        message="chunk audit reported quality issues",
        actual=chunk_audit_report.get("issue_counts") or {},
        expected={"passed": True},
    )
    disallowed_document_page_families = count_by_value(
        require_text(document.get("page_family"), "page_family")
        for document in replay_documents
        if require_text(document.get("serving_intent") or "unknown", "serving_intent")
        == "promotable"
        and require_text(document.get("page_family"), "page_family")
        in _PROMOTION_DISALLOWED_PAGE_FAMILIES
    )
    unknown_document_serving_intents = {
        serving_intent: count
        for serving_intent, count in document_serving_intent_counts.items()
        if serving_intent not in {"promotable", "audit_only"} and count > 0
    }
    record_check(
        code="promotable_page_families",
        passed=not disallowed_document_page_families,
        message="projection replay emitted promotable documents with page families that must stay staged-only",
        actual=disallowed_document_page_families,
        expected={"disallowed": sorted(_PROMOTION_DISALLOWED_PAGE_FAMILIES)},
    )
    record_check(
        code="recognized_serving_intent",
        passed=not unknown_document_serving_intents,
        message="projection replay emitted documents with unknown serving_intent values",
        actual=document_serving_intent_counts,
        expected={"allowed": ["promotable", "audit_only"]},
    )
    inventory_only_promotable_documents = [
        require_text(document.get("document_id"), "document_id")
        for document in replay_documents
        if require_text(document.get("serving_intent") or "unknown", "serving_intent")
        == "promotable"
        and optional_text(document.get("materialization_policy")) == "inventory_only"
    ]
    record_check(
        code="target_lineage_valid",
        passed=not target_lineage_issues,
        message="target-workset replay contains pages with missing or invalid target lineage",
        actual={
            "issue_count": len(target_lineage_issues),
            "issues": target_lineage_issues,
        },
        expected={"issue_count": 0},
    )
    record_check(
        code="inventory_only_not_promotable",
        passed=not inventory_only_promotable_documents,
        message="inventory-only target records must not be promoted to current truth",
        actual=inventory_only_promotable_documents,
        expected={"document_ids": []},
    )

    return {
        "passed": len(blocked_checks) == 0,
        "counts": {
            "expected_host_count": len(expected_host_set),
            "actual_host_count": len(actual_host_set),
            "seed_count": len(seed_set),
            "pages_seen": pages_seen,
            "emitted_documents": emitted_documents,
            "manual_review_pages": manual_review_pages,
        },
        "ratios": {
            "seed_coverage_ratio": seed_coverage_ratio,
            "host_coverage_ratio": host_coverage_ratio,
        },
        "actualHosts": actual_host_set,
        "documentPageFamilyCounts": document_page_family_counts,
        "documentServingIntentCounts": document_serving_intent_counts,
        "targetFamilyCounts": target_family_counts,
        "targetMaterializationPolicyCounts": target_materialization_policy_counts,
        "targetLineageIssues": target_lineage_issues,
        "manualReviewPageFamilyCounts": manual_review_page_family_counts,
        "checks": checks,
        "blockedChecks": blocked_checks,
    }


def build_consumer_candidate_review_report(
    *,
    replay_report: dict[str, object],
    consumer_review_manifest: dict[str, object] | None = None,
    run_admission_decision: dict[str, object] | None = None,
    target_inventory_manifest: dict[str, object] | None = None,
) -> dict[str, object]:
    verdicts = _review_verdicts(
        consumer_review_manifest=consumer_review_manifest,
        replay_report=replay_report,
    )
    run_excluded = _is_run_admission_excluded(run_admission_decision)
    target_inventory_entries = _target_inventory_entries(target_inventory_manifest)
    raw_candidates = require_object_list(
        replay_report.get("consumer_candidate_pages"),
        "consumer_candidate_pages",
    )
    candidates = [
        _build_consumer_candidate_review_entry(
            index=index,
            candidate=candidate,
            run_excluded=run_excluded,
            target_inventory_entry=_target_inventory_entry_for_candidate(
                candidate=candidate,
                target_inventory_entries=target_inventory_entries,
            ),
            verdicts=verdicts,
        )
        for index, candidate in enumerate(raw_candidates, start=1)
    ]
    selected_write_candidates = [
        candidate for candidate in candidates if _is_selected_write_candidate(candidate)
    ]
    inventory_only_candidates = [
        candidate for candidate in candidates if candidate["admission_action"] == "inventory_only"
    ]
    release_gate_candidates = [
        candidate
        for candidate in candidates
        if candidate["admission_action"] == "release_gate_required"
    ]
    selected_write_ready = [
        candidate for candidate in candidates if candidate["ready_for_selected_write"]
    ]
    selected_write_rejected = [
        candidate
        for candidate in selected_write_candidates
        if candidate["review_verdict"] == "rejected"
    ]
    selected_write_pending = [
        candidate
        for candidate in selected_write_candidates
        if not candidate["ready_for_selected_write"]
        and candidate["review_verdict"] in {"pending_review", "needs_more_evidence"}
    ]
    selected_write_blocked = [
        candidate
        for candidate in selected_write_candidates
        if not candidate["ready_for_selected_write"] and candidate["review_verdict"] != "rejected"
    ]
    stable_reference_documents = [
        document
        for document in require_object_list(replay_report.get("documents"), "documents")
        if require_text(document.get("target_corpus"), "target_corpus") == "official_web"
        and require_text(document.get("target_collection"), "target_collection")
        == "stable_reference"
    ]
    stable_reference_target_field_reviews = [
        review
        for review in (
            _stable_reference_target_field_review_record(
                document=document,
                run_id=require_text(replay_report.get("crawl_run_id"), "crawl_run_id"),
                target_inventory_entry=_target_inventory_entry_for_document(
                    document=document,
                    target_inventory_entries=target_inventory_entries,
                ),
            )
            for document in stable_reference_documents
        )
        if review is not None
    ]
    return {
        "schemaVersion": "official_web_consumer_candidate_review.v1",
        "status": "pending_review"
        if candidates or stable_reference_documents
        else "not_applicable",
        "counts": {
            "candidate_count": len(candidates),
            "selected_write_candidate_count": len(selected_write_candidates),
            "selected_write_ready_count": len(selected_write_ready),
            "selected_write_rejected_count": len(selected_write_rejected),
            "selected_write_pending_count": len(selected_write_pending),
            "selected_write_blocked_count": len(selected_write_blocked),
            "inventory_only_count": len(inventory_only_candidates),
            "release_gate_candidate_count": len(release_gate_candidates),
            "stable_reference_release_candidate_count": len(stable_reference_documents),
            "by_consumer_family": count_by_value(
                str(candidate["consumer_family"]) for candidate in candidates
            ),
            "by_materialization_policy": count_by_value(
                str(candidate["materialization_policy"]) for candidate in candidates
            ),
        },
        "selectedWrite": _build_selected_write_admission_preview(
            candidate_count=len(selected_write_candidates),
            ready_count=len(selected_write_ready),
            rejected_count=len(selected_write_rejected),
            pending_count=len(selected_write_pending),
            blocked_count=len(selected_write_blocked),
            run_excluded=run_excluded,
            ready_candidates=selected_write_ready,
        ),
        "stableReferenceRelease": {
            "decision": "release_gate_required" if stable_reference_documents else "not_applicable",
            "candidate_count": len(stable_reference_documents),
            "serving_alias_update": "not_allowed_in_consumer_denominator_recovery",
        },
        "targetFieldReviews": [
            review
            for review in (
                _target_field_review_record(
                    candidate=candidate,
                    run_id=require_text(replay_report.get("crawl_run_id"), "crawl_run_id"),
                )
                for candidate in candidates
            )
            if review is not None
        ]
        + stable_reference_target_field_reviews,
        "candidates": candidates,
    }


def _build_consumer_candidate_review_entry(
    *,
    index: int,
    candidate: dict[str, object],
    run_excluded: bool,
    target_inventory_entry: dict[str, object] | None,
    verdicts: dict[str, dict[str, object]],
) -> dict[str, object]:
    consumer_family = require_text(candidate.get("consumer_family"), "consumer_family")
    materialization_policy = require_text(
        candidate.get("materialization_policy"),
        "materialization_policy",
    )
    selected_write_target = optional_text(candidate.get("selected_write_target"))
    matched_evidence = normalize_string_list(candidate.get("matched_evidence"))
    admission_action = _candidate_admission_action(
        consumer_family=consumer_family,
        materialization_policy=materialization_policy,
    )
    candidate_key = optional_text(candidate.get("candidate_key")) or (
        f"legacy:{consumer_family}:{require_text(candidate.get('raw_asset_id'), 'raw_asset_id')}:"
        f"{require_text(candidate.get('raw_version_id'), 'raw_version_id')}:{index}"
    )
    review_verdict = _candidate_review_verdict(
        admission_action=admission_action,
        candidate_key=candidate_key,
        verdicts=verdicts,
    )
    quality_gate = (
        candidate.get("quality_gate") if isinstance(candidate.get("quality_gate"), dict) else {}
    )
    typed_candidate = (
        candidate.get("typed_candidate")
        if isinstance(candidate.get("typed_candidate"), dict)
        else {}
    )
    typed_candidate_schema_version = optional_text(candidate.get("typed_candidate_schema_version"))
    required_fields = _target_inventory_required_fields(target_inventory_entry)
    optional_fields = _target_inventory_optional_fields(target_inventory_entry)
    required_evidence = _target_inventory_required_evidence(target_inventory_entry)
    optional_evidence = _target_inventory_optional_evidence(target_inventory_entry)
    blocking_review_fields = _target_inventory_review_fields(
        required_fields=required_fields,
        required_evidence=required_evidence,
    )
    optional_review_fields = _target_inventory_review_fields(
        required_fields=optional_fields,
        required_evidence=optional_evidence,
    )
    review_fields = _unique_strings([*blocking_review_fields, *optional_review_fields])
    field_status = _field_status_for_required_fields(
        candidate=candidate,
        optional_fields=optional_review_fields,
        required_fields=review_fields,
        typed_candidate=typed_candidate,
    )
    ready_for_selected_write = (
        _ready_for_selected_write(
            admission_action=admission_action,
            field_status=field_status,
            required_fields=blocking_review_fields,
            review_verdict=review_verdict,
            quality_gate=quality_gate,
            typed_candidate=typed_candidate,
            typed_candidate_schema_version=typed_candidate_schema_version,
        )
        and not run_excluded
    )
    effective_admission_action = (
        "selected_write_ready" if ready_for_selected_write else admission_action
    )
    if admission_action == "selected_write_review_required" and review_verdict == "rejected":
        effective_admission_action = "selected_write_rejected"
    return {
        "candidate_key": candidate_key,
        "consumer_family": consumer_family,
        "materialization_policy": materialization_policy,
        "selected_write_target": selected_write_target,
        "target_candidate_id": optional_text(candidate.get("target_candidate_id")),
        "target_declaration_version": optional_text(candidate.get("target_declaration_version")),
        "target_id": optional_text(candidate.get("target_id")),
        "target_job_id": optional_text(candidate.get("target_job_id")),
        "target_label": optional_text(target_inventory_entry.get("target_label"))
        if target_inventory_entry is not None
        else None,
        "review_policy": require_text(candidate.get("review_policy"), "review_policy"),
        "title": require_text(candidate.get("title"), "title"),
        "normalized_canonical_url": require_text(
            candidate.get("normalized_canonical_url"),
            "normalized_canonical_url",
        ),
        "matched_evidence": matched_evidence,
        "source_ref": {
            "source_channel": "official_web",
            "raw_asset_id": require_text(candidate.get("raw_asset_id"), "raw_asset_id"),
            "raw_version_id": require_text(candidate.get("raw_version_id"), "raw_version_id"),
            "normalized_canonical_url": require_text(
                candidate.get("normalized_canonical_url"),
                "normalized_canonical_url",
            ),
        },
        "source_refs": _candidate_source_refs(candidate),
        "inventory_id": optional_text(target_inventory_entry.get("inventory_id"))
        if target_inventory_entry is not None
        else None,
        "optional_evidence": optional_evidence,
        "optional_fields": optional_review_fields,
        "required_evidence": required_evidence,
        "required_fields": blocking_review_fields,
        "field_status": field_status,
        "typed_candidate_schema_version": typed_candidate_schema_version,
        "typed_candidate": typed_candidate,
        "quality_gate": quality_gate,
        "evidence_spans": require_object_list(candidate.get("evidence_spans"), "evidence_spans")
        if isinstance(candidate.get("evidence_spans"), list)
        else [],
        "review_verdict": review_verdict,
        "admission_action": effective_admission_action,
        "ready_for_selected_write": ready_for_selected_write,
        "blocked_reason": None
        if ready_for_selected_write or review_verdict == "rejected"
        else _candidate_blocked_reason(
            admission_action=admission_action,
            quality_gate=quality_gate,
            review_verdict=review_verdict,
            run_excluded=run_excluded,
            required_fields=blocking_review_fields,
            field_status=field_status,
            typed_candidate=typed_candidate,
            typed_candidate_schema_version=typed_candidate_schema_version,
        ),
    }


def _target_inventory_entries(
    target_inventory_manifest: dict[str, object] | None,
) -> list[dict[str, object]]:
    if target_inventory_manifest is None:
        return []
    if target_inventory_manifest.get("schema_version") != "official_web_target_inventory.v1":
        return []
    return require_object_list(target_inventory_manifest.get("entries"), "entries")


def _candidate_source_refs(candidate: dict[str, object]) -> list[dict[str, object]]:
    refs = _candidate_explicit_source_refs(candidate)
    if not refs:
        refs = [
            {
                "source_channel": "official_web",
                "raw_asset_id": require_text(candidate.get("raw_asset_id"), "raw_asset_id"),
                "raw_version_id": require_text(candidate.get("raw_version_id"), "raw_version_id"),
                "normalized_canonical_url": require_text(
                    candidate.get("normalized_canonical_url"),
                    "normalized_canonical_url",
                ),
            }
        ]
    typed_candidate = candidate.get("typed_candidate")
    if isinstance(typed_candidate, dict):
        for url in normalize_string_list(
            typed_candidate.get("supporting_source_urls")
            or typed_candidate.get("supportingSourceUrls")
        ):
            if not any(ref["normalized_canonical_url"] == url for ref in refs):
                refs.append(
                    {
                        "source_channel": "official_web",
                        "raw_asset_id": "",
                        "raw_version_id": "",
                        "normalized_canonical_url": url,
                    }
                )
    return refs


def _candidate_explicit_source_refs(candidate: dict[str, object]) -> list[dict[str, object]]:
    raw_refs = candidate.get("source_refs") or candidate.get("sourceRefs")
    if not isinstance(raw_refs, list):
        return []
    refs: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_ref in raw_refs:
        if not isinstance(raw_ref, dict):
            continue
        normalized_url = optional_text(
            raw_ref.get("normalized_canonical_url") or raw_ref.get("normalizedCanonicalUrl")
        )
        if normalized_url is None or normalized_url in seen:
            continue
        seen.add(normalized_url)
        refs.append(
            {
                "source_channel": optional_text(
                    raw_ref.get("source_channel") or raw_ref.get("sourceChannel")
                )
                or "official_web",
                "raw_asset_id": optional_text(
                    raw_ref.get("raw_asset_id") or raw_ref.get("rawAssetId")
                )
                or "",
                "raw_version_id": optional_text(
                    raw_ref.get("raw_version_id") or raw_ref.get("rawVersionId")
                )
                or "",
                "normalized_canonical_url": normalized_url,
            }
        )
    return refs


def _target_inventory_entry_for_candidate(
    *,
    candidate: dict[str, object],
    target_inventory_entries: list[dict[str, object]],
) -> dict[str, object] | None:
    target_id = optional_text(candidate.get("target_id"))
    normalized_canonical_url = optional_text(candidate.get("normalized_canonical_url"))
    if target_id is None:
        return None
    for entry in target_inventory_entries:
        if optional_text(entry.get("admission_target_id")) != target_id:
            continue
        source_urls = normalize_string_list(entry.get("source_urls"))
        if source_urls and normalized_canonical_url not in source_urls:
            continue
        return entry
    return None


def _target_inventory_entry_for_document(
    *,
    document: dict[str, object],
    target_inventory_entries: list[dict[str, object]],
) -> dict[str, object] | None:
    target_id = optional_text(document.get("target_id"))
    normalized_canonical_url = optional_text(document.get("normalized_canonical_url"))
    if target_id is None:
        return None
    for entry in target_inventory_entries:
        if optional_text(entry.get("admission_target_id")) != target_id:
            continue
        source_urls = normalize_string_list(entry.get("source_urls"))
        if source_urls and normalized_canonical_url not in source_urls:
            continue
        return entry
    return None


def _target_inventory_required_fields(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("required_fields"))


def _target_inventory_optional_fields(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("optional_fields"))


def _target_inventory_required_evidence(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("required_evidence"))


def _target_inventory_optional_evidence(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("optional_evidence"))


def _target_inventory_review_fields(
    *,
    required_fields: list[str],
    required_evidence: list[str],
) -> list[str]:
    fields: list[str] = []
    for field_name in [*required_fields, *required_evidence]:
        if field_name not in fields:
            fields.append(field_name)
    return fields


def _unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "authoritative_source_url": ("source_url",),
    "email": ("emails", "contacts.emails"),
    "location": ("locations", "contacts.locations"),
    "normalized_content_summary": ("normalized_content_summary", "summary"),
    "office_hours": ("office_hours", "contacts.office_hours"),
    "organization_name": ("organization_name", "display_name", "source_title"),
    "phone": ("phones", "contacts.phones"),
    "process_steps": ("process_steps",),
    "reference_title": ("reference_title", "source_title"),
    "release_scope": ("release_scope",),
    "required_materials": ("required_materials", "materials"),
    "responsible_office": ("responsible_office",),
    "service_entry": ("entry_points",),
    "service_material": ("required_materials", "materials"),
    "service_name": ("service_name",),
    "service_process": ("process_steps",),
    "source_url": ("source_url",),
}


def _field_status_for_required_fields(
    *,
    candidate: dict[str, object],
    optional_fields: list[str],
    required_fields: list[str],
    typed_candidate: dict[object, object],
) -> dict[str, str]:
    optional_field_set = set(optional_fields)
    return {
        field_name: _normalize_optional_field_status(
            field_name=field_name,
            optional_field_set=optional_field_set,
            status=_field_status_for_required_field(
                candidate=candidate,
                field_name=field_name,
                typed_candidate=typed_candidate,
            ),
        )
        for field_name in required_fields
    }


def _normalize_optional_field_status(
    *,
    field_name: str,
    optional_field_set: set[str],
    status: str,
) -> str:
    if field_name in optional_field_set and status == "missing":
        return "source_not_provided"
    return status


def _field_status_for_required_field(
    *,
    candidate: dict[str, object],
    field_name: str,
    typed_candidate: dict[object, object],
) -> str:
    if field_name == "source_version_evidence":
        return (
            "present"
            if optional_text(candidate.get("raw_asset_id"))
            and optional_text(candidate.get("raw_version_id"))
            else "missing"
        )
    if field_name == "source_url":
        return "present" if optional_text(candidate.get("normalized_canonical_url")) else "missing"
    for field_path in _FIELD_ALIASES.get(field_name, (field_name,)):
        if _is_present_value(_lookup_field_path(typed_candidate, field_path)):
            return "present"
    return "missing"


def _lookup_field_path(value: dict[object, object], field_path: str) -> object:
    current: object = value
    for part in field_path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _is_present_value(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_is_present_value(item) for item in value)
    if isinstance(value, dict):
        return any(_is_present_value(item) for item in value.values())
    return value is not None


def _evidence_span_present(*, candidate: dict[str, object], evidence_type: str) -> bool:
    if not isinstance(candidate.get("evidence_spans"), list):
        return False
    for span in require_object_list(candidate.get("evidence_spans"), "evidence_spans"):
        if optional_text(span.get("evidence_type")) == evidence_type and optional_text(
            span.get("text")
        ):
            return True
    return False


def _target_field_review_record(
    *,
    candidate: dict[str, object],
    run_id: str,
) -> dict[str, object] | None:
    job_id = optional_text(candidate.get("target_job_id"))
    field_status = candidate.get("field_status")
    if job_id is None or not isinstance(field_status, dict) or not field_status:
        return None
    status = (
        "ready_for_selected_write"
        if bool(candidate.get("ready_for_selected_write"))
        else "blocked_fields"
        if _has_blocking_field_status(
            field_status=field_status,
            required_fields=normalize_string_list(candidate.get("required_fields")),
        )
        else "pending_review"
    )
    return {
        "canonicalVerification": False,
        "jobId": job_id,
        "runId": run_id,
        "sourceHandoffId": None,
        "status": status,
        "summary": {
            "schemaVersion": "official_web_target_field_review.v1",
            "candidateKey": require_text(candidate.get("candidate_key"), "candidate_key"),
            "consumerFamily": require_text(candidate.get("consumer_family"), "consumer_family"),
            "fieldStatus": field_status,
            "inventoryId": candidate.get("inventory_id"),
            "normalizedCanonicalUrl": require_text(
                candidate.get("normalized_canonical_url"),
                "normalized_canonical_url",
            ),
            "readyForSelectedWrite": bool(candidate.get("ready_for_selected_write")),
            "optionalEvidence": normalize_string_list(candidate.get("optional_evidence")),
            "optionalFields": normalize_string_list(candidate.get("optional_fields")),
            "requiredEvidence": normalize_string_list(candidate.get("required_evidence")),
            "requiredFields": normalize_string_list(candidate.get("required_fields")),
            "reviewVerdict": require_text(candidate.get("review_verdict"), "review_verdict"),
            "selectedWriteTarget": candidate.get("selected_write_target"),
            "sourceRef": candidate.get("source_ref"),
            "targetId": candidate.get("target_id"),
        },
    }


def _stable_reference_target_field_review_record(
    *,
    document: dict[str, object],
    run_id: str,
    target_inventory_entry: dict[str, object] | None,
) -> dict[str, object] | None:
    job_id = optional_text(document.get("target_job_id"))
    required_fields = _target_inventory_required_fields(target_inventory_entry)
    if job_id is None or not required_fields:
        return None
    field_status = _stable_reference_field_status_for_required_fields(
        document=document,
        required_fields=required_fields,
    )
    status = (
        "blocked_fields"
        if any(value in {"missing", "ambiguous"} for value in field_status.values())
        else "release_gate_required"
    )
    normalized_canonical_url = require_text(
        document.get("normalized_canonical_url"),
        "normalized_canonical_url",
    )
    return {
        "canonicalVerification": False,
        "jobId": job_id,
        "runId": run_id,
        "sourceHandoffId": None,
        "status": status,
        "summary": {
            "schemaVersion": "official_web_target_field_review.v1",
            "candidateKey": (
                f"owdoc:{require_text(document.get('document_id'), 'document_id')}:"
                f"{require_text(document.get('version_id'), 'version_id')}"
            ),
            "consumerFamily": "stable_reference_candidate",
            "fieldStatus": field_status,
            "inventoryId": optional_text(target_inventory_entry.get("inventory_id"))
            if target_inventory_entry is not None
            else None,
            "normalizedCanonicalUrl": normalized_canonical_url,
            "readyForSelectedWrite": False,
            "requiredFields": required_fields,
            "reviewVerdict": "pending_review",
            "selectedWriteTarget": document.get("selected_write_target"),
            "sourceRef": {
                "source_channel": "official_web",
                "raw_asset_id": require_text(document.get("raw_asset_id"), "raw_asset_id"),
                "raw_version_id": require_text(document.get("raw_version_id"), "raw_version_id"),
                "normalized_canonical_url": normalized_canonical_url,
            },
            "targetId": document.get("target_id"),
        },
    }


def _stable_reference_field_status_for_required_fields(
    *,
    document: dict[str, object],
    required_fields: list[str],
) -> dict[str, str]:
    return {
        field_name: _stable_reference_field_status_for_required_field(
            document=document,
            field_name=field_name,
        )
        for field_name in required_fields
    }


def _stable_reference_field_status_for_required_field(
    *,
    document: dict[str, object],
    field_name: str,
) -> str:
    if field_name == "reference_title":
        return "present" if optional_text(document.get("title")) else "missing"
    if field_name == "normalized_content_summary":
        return (
            "present"
            if coerce_non_negative_int(document.get("unit_count")) > 0
            or optional_text(document.get("canonical_markdown_path"))
            else "missing"
        )
    if field_name in {"authoritative_source_url", "source_url"}:
        return "present" if optional_text(document.get("normalized_canonical_url")) else "missing"
    if field_name == "release_scope":
        return (
            "present"
            if optional_text(document.get("target_corpus")) == "official_web"
            and optional_text(document.get("target_collection")) == "stable_reference"
            else "missing"
        )
    if field_name == "source_version_evidence":
        return (
            "present"
            if optional_text(document.get("raw_asset_id"))
            and optional_text(document.get("raw_version_id"))
            else "missing"
        )
    return "not_applicable"


def _candidate_admission_action(
    *,
    consumer_family: str,
    materialization_policy: str,
) -> str:
    if materialization_policy == "inventory_only" or consumer_family == "notice_news_candidate":
        return "inventory_only"
    if materialization_policy == "release_gate_required":
        return "release_gate_required"
    return "selected_write_review_required"


def _candidate_blocked_reason(
    *,
    admission_action: str,
    field_status: dict[str, str],
    quality_gate: dict[object, object],
    required_fields: list[str],
    review_verdict: str,
    run_excluded: bool,
    typed_candidate: dict[object, object],
    typed_candidate_schema_version: str | None,
) -> str:
    if run_excluded:
        return "run_admission_decision_excluded"
    if admission_action == "inventory_only":
        return "inventory_only_until_runtime_admission"
    if admission_action == "release_gate_required":
        return "release_gate_required_before_current_truth"
    if not required_fields:
        return "target_inventory_required_fields_missing"
    if str(quality_gate.get("decision") or "") != "pass":
        return "machine_review_candidate_failed_quality_gate"
    if not typed_candidate_schema_version or not typed_candidate:
        return "machine_review_candidate_missing_typed_candidate"
    if _has_blocking_field_status(field_status=field_status, required_fields=required_fields):
        return "machine_field_review_blocked"
    if review_verdict == "needs_more_evidence":
        return "review_marked_needs_more_evidence"
    return "machine_field_review_required_before_selected_write"


def _build_selected_write_admission_preview(
    *,
    candidate_count: int,
    ready_count: int,
    rejected_count: int,
    pending_count: int,
    blocked_count: int,
    run_excluded: bool,
    ready_candidates: list[dict[str, object]],
) -> dict[str, object]:
    if candidate_count == 0:
        return {
            "decision": "not_applicable",
            "ready_record_count": 0,
            "rejected_record_count": 0,
            "pending_record_count": 0,
            "blocked_record_count": 0,
            "reason": "no_selected_write_candidates",
            "preview_records": [],
        }
    if run_excluded:
        return {
            "decision": "blocked",
            "ready_record_count": 0,
            "rejected_record_count": rejected_count,
            "pending_record_count": pending_count,
            "blocked_record_count": blocked_count,
            "reason": "run_admission_decision_excluded",
            "preview_records": [],
        }
    if ready_count == 0 and rejected_count == candidate_count:
        decision = "no_ready_records"
        reason = "all_candidates_rejected"
    elif ready_count > 0 and blocked_count > 0:
        decision = "partial_dry_run_ready"
        reason = "machine_field_review_partially_passed"
    elif ready_count > 0:
        decision = "dry_run_ready"
        reason = "machine_field_review_passed"
    else:
        decision = "blocked"
        reason = "machine_field_review_blocked"
    return {
        "decision": decision,
        "ready_record_count": ready_count,
        "rejected_record_count": rejected_count,
        "pending_record_count": pending_count,
        "blocked_record_count": blocked_count,
        "reason": reason,
        "preview_records": [
            _selected_write_preview_record(candidate) for candidate in ready_candidates
        ],
    }


def _is_run_admission_excluded(
    run_admission_decision: dict[str, object] | None,
) -> bool:
    if run_admission_decision is None:
        return False
    decision = optional_text(
        run_admission_decision.get("decision") or run_admission_decision.get("admissionDecision")
    )
    return decision == "legacy_contract_excluded"


def _review_verdicts(
    *,
    consumer_review_manifest: dict[str, object] | None,
    replay_report: dict[str, object],
) -> dict[str, dict[str, object]]:
    if consumer_review_manifest is None:
        return {}
    if consumer_review_manifest.get("schema_version") != (
        "official_web_selected_write_review_manifest.v1"
    ):
        raise ValueError("unsupported official web selected-write review manifest schema_version")
    site_id = require_text(replay_report.get("site_id"), "site_id")
    run_id = require_text(replay_report.get("crawl_run_id"), "crawl_run_id")
    if require_text(consumer_review_manifest.get("site_id"), "site_id") != site_id:
        raise ValueError("consumer review manifest site_id does not match replay report")
    if require_text(consumer_review_manifest.get("run_id"), "run_id") != run_id:
        raise ValueError("consumer review manifest run_id does not match replay report")
    verdicts: dict[str, dict[str, object]] = {}
    for verdict in require_object_list(consumer_review_manifest.get("verdicts"), "verdicts"):
        candidate_key = require_text(verdict.get("candidate_key"), "candidate_key")
        normalized_verdict = require_text(verdict.get("verdict"), "verdict")
        if normalized_verdict not in {"approved", "rejected", "needs_more_evidence"}:
            raise ValueError(f"unsupported consumer review verdict: {normalized_verdict}")
        if candidate_key in verdicts:
            raise ValueError(f"duplicate consumer review verdict: {candidate_key}")
        verdicts[candidate_key] = verdict
    return verdicts


def _candidate_review_verdict(
    *,
    admission_action: str,
    candidate_key: str,
    verdicts: dict[str, dict[str, object]],
) -> str:
    if admission_action == "inventory_only":
        return "inventory_only"
    if admission_action == "release_gate_required":
        return "pending_review"
    verdict = verdicts.get(candidate_key)
    if verdict is None:
        return "pending_review"
    return require_text(verdict.get("verdict"), "verdict")


def _ready_for_selected_write(
    *,
    admission_action: str,
    field_status: dict[str, str],
    required_fields: list[str],
    review_verdict: str,
    quality_gate: dict[object, object],
    typed_candidate: dict[object, object],
    typed_candidate_schema_version: str | None,
) -> bool:
    return (
        admission_action == "selected_write_review_required"
        and review_verdict not in {"rejected", "needs_more_evidence"}
        and str(quality_gate.get("decision") or "") == "pass"
        and bool(typed_candidate_schema_version)
        and bool(typed_candidate)
        and bool(field_status)
        and bool(required_fields)
        and all(field_status.get(field_name) == "present" for field_name in required_fields)
    )


def _has_blocking_field_status(
    *,
    field_status: dict[str, object],
    required_fields: list[str],
) -> bool:
    if not required_fields:
        return True
    return any(
        str(field_status.get(field_name) or "missing") in {"missing", "ambiguous"}
        for field_name in required_fields
    )


def _is_selected_write_candidate(candidate: dict[str, object]) -> bool:
    return (
        str(candidate.get("materialization_policy") or "") == "candidate_only"
        and optional_text(candidate.get("selected_write_target")) is not None
    )


def _selected_write_preview_record(candidate: dict[str, object]) -> dict[str, object]:
    selected_write_target = require_text(
        candidate.get("selected_write_target"),
        "selected_write_target",
    )
    target_corpus, target_collection = selected_write_target.split("/", 1)
    return {
        "candidate_key": require_text(candidate.get("candidate_key"), "candidate_key"),
        "field_status": dict(candidate.get("field_status"))
        if isinstance(candidate.get("field_status"), dict)
        else {},
        "inventory_id": optional_text(candidate.get("inventory_id")),
        "matched_evidence": normalize_string_list(candidate.get("matched_evidence")),
        "normalized_canonical_url": require_text(
            candidate.get("normalized_canonical_url"),
            "normalized_canonical_url",
        ),
        "optional_evidence": normalize_string_list(candidate.get("optional_evidence")),
        "optional_fields": normalize_string_list(candidate.get("optional_fields")),
        "ready_for_selected_write": bool(candidate.get("ready_for_selected_write")),
        "required_evidence": normalize_string_list(candidate.get("required_evidence")),
        "required_fields": normalize_string_list(candidate.get("required_fields")),
        "review_verdict": require_text(candidate.get("review_verdict"), "review_verdict"),
        "selected_write_target": selected_write_target,
        "source_ref": candidate.get("source_ref"),
        "target_id": optional_text(candidate.get("target_id")),
        "target_job_id": optional_text(candidate.get("target_job_id")),
        "target_label": optional_text(candidate.get("target_label")),
        "target_corpus": target_corpus,
        "target_collection": target_collection,
        "typed_candidate_schema_version": candidate.get("typed_candidate_schema_version"),
        "typed_candidate": candidate.get("typed_candidate"),
    }


def _int_mapping(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key, raw_count in value.items():
        if not isinstance(key, str) or not key.strip():
            continue
        result[key] = coerce_non_negative_int(raw_count)
    return result


def build_promotion_report(
    *,
    promote_import: bool,
    coverage_report: dict[str, object],
) -> dict[str, object]:
    blocked_checks = coverage_report.get("blockedChecks")
    if not isinstance(blocked_checks, list):
        blocked_checks = []
    if not promote_import:
        return {
            "mode": "stage",
            "eligible": bool(coverage_report.get("passed")),
            "decision": "staged",
            "blockedChecks": blocked_checks,
        }
    if blocked_checks:
        return {
            "mode": "promote",
            "eligible": False,
            "decision": "blocked",
            "blockedChecks": blocked_checks,
        }
    return {
        "mode": "promote",
        "eligible": True,
        "decision": "promoted",
        "blockedChecks": [],
    }


def build_status_reporter_from_env() -> OfficialWebExecutionStatusReporter | None:
    base_url = os.getenv("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = os.getenv("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not base_url or not shared_secret:
        return None
    return HttpOfficialWebExecutionStatusReporter(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


def report_execution_status(
    *,
    reporter: OfficialWebExecutionStatusReporter | None,
    run_id: str,
    payload: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    if reporter is None:
        return
    try:
        reporter.report(run_id=run_id, payload=payload)
    except Exception:
        if not suppress_errors:
            raise


def build_promotion_blocked_message(blocked_checks: object) -> str:
    if not isinstance(blocked_checks, list) or not blocked_checks:
        return "promotion blocked by quality gates"
    labels = [optional_text(item.get("code")) for item in blocked_checks if isinstance(item, dict)]
    normalized = [label for label in labels if label is not None]
    if not normalized:
        return "promotion blocked by quality gates"
    return "promotion blocked by quality gates: " + ", ".join(normalized)
