from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_classification import (
    classification_evidence_strength,
    classification_target_candidates,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_document_id,
)

PHASE_06_R1_ID = "phase-06-r1-regulation-candidate-audit-and-admission"
ADMISSION_SCHEMA_VERSION = "collected_notice_consumer_admission.v1"
CANDIDATE_AUDIT_SCHEMA_VERSION = "collected_notice_regulation_candidate_audit.v1"
REJECTED_DEFERRED_SCHEMA_VERSION = "collected_notice_regulation_rejected_deferred.v1"
SOURCE_TRACE_SCHEMA_VERSION = "collected_notice_regulation_source_trace.v1"
REGULATION_TARGET = "regulation"
INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"

REGULATION_CLASS_INSTITUTIONAL = "institutional_rules_candidate"
REGULATION_CLASS_SCOPED = "scoped_rules_candidate"
REGULATION_CLASS_NEEDS_MULTIMODAL = "needs_multimodal"
REGULATION_CLASS_WRAPPER_ONLY = "wrapper_only_searchable"
REGULATION_CLASS_DUPLICATE_HOLD = "duplicate_hold"
REGULATION_CLASS_MANUAL_REVIEW = "manual_review"
REGULATION_CLASS_INVALID_CAPTURE = "invalid_capture"

_FORMAL_REGULATION_KEYWORDS = (
    "办法",
    "规定",
    "细则",
    "条例",
    "章程",
    "准则",
    "指导意见",
    "管理制度",
    "管理办法",
    "规章",
    "制度",
)
_WRAPPER_NOTICE_PREFIXES = ("关于发布", "关于印发", "关于修订", "关于转发", "关于公布")
_WRAPPER_NOTICE_KEYWORDS = ("通知", "现将", "予以发布", "予以印发", "请遵照执行", "转发")
_ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS = (
    "报名时间",
    "网上报名",
    "报名网址",
    "选拔对象",
    "申请条件",
    "综合考核",
    "拟录取",
    "推免",
    "免试攻读",
    "硕博连读",
    "英才计划",
    "招生实施细则",
    "家庭经济困难学生认定",
)
_TIME_BOUND_OPERATIONAL_KEYWORDS = (
    "暑假期间",
    "寒假期间",
    "假期期间",
    "临时",
    "暂行",
    "试行",
    "过渡期",
)
_DRAFT_OR_SCHEME_KEYWORDS = ("征求意见稿", "草案", "讨论稿", "工作方案", "实施方案")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")
_ARTICLE_MARKER_RE = re.compile(r"(^|\n)\s*第[一二三四五六七八九十百千万0-9]+条", re.MULTILINE)
_SECTION_MARKER_RE = re.compile(r"(^|\n)\s*[一二三四五六七八九十]+[、.]", re.MULTILINE)
_SUBSECTION_MARKER_RE = re.compile(r"(^|\n)\s*[（(][一二三四五六七八九十0-9]+[)）]", re.MULTILINE)
_NUMERIC_LIST_MARKER_RE = re.compile(r"(^|\n)\s*[0-9]{1,2}[、.]", re.MULTILINE)
_TEXT_MATCH_NORMALIZE_RE = re.compile(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>]")
_FILENAME_SUFFIX_RE = re.compile(r"\.(?:docx?|pdf|xlsx?)$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationAdmissionPreview:
    admission_manifest: dict[str, Any]
    candidate_audit: dict[str, Any]
    rejected_deferred_source_report: dict[str, Any]
    source_to_searchable_trace: dict[str, Any]


class RegulationOwnerTextObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class _RegulationDecision:
    unit: Mapping[str, Any]
    regulation_admission_class: str
    consumption_class: str
    reason_codes: tuple[str, ...]
    candidate_key: str | None
    regulation_title: str | None
    issuing_org: str
    target_collection: str | None
    target_surface: str | None
    target_identity_preview: str | None
    duplicate_primary_source_notice_id: str | None
    duplicate_primary_searchable_unit_id: str | None
    queue_trace_row: Mapping[str, Any] | None

    @property
    def admitted(self) -> bool:
        return self.regulation_admission_class in {
            REGULATION_CLASS_INSTITUTIONAL,
            REGULATION_CLASS_SCOPED,
        }


def build_collected_notice_regulation_admission_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    queue_consume_trace_path: Path | None = None,
    owner_text_execution_report_path: Path | None = None,
    owner_text_object_store: RegulationOwnerTextObjectStoreReader | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_regulation_admission",
) -> CollectedNoticeRegulationAdmissionPreview:
    queue_trace = (
        _load_json_object(queue_consume_trace_path)
        if queue_consume_trace_path is not None and Path(queue_consume_trace_path).exists()
        else None
    )
    owner_text_report = (
        _load_json_object(owner_text_execution_report_path)
        if owner_text_execution_report_path is not None
        and Path(owner_text_execution_report_path).exists()
        else None
    )
    recovered_owner_text_by_unit = None
    if owner_text_report is not None:
        if owner_text_object_store is None:
            raise ValueError(
                "owner_text_object_store is required when owner_text_execution_report_path is set"
            )
        recovered_owner_text_by_unit = build_recovered_owner_text_by_unit_from_execution_report(
            execution_report=owner_text_report,
            object_store=owner_text_object_store,
        )
    return build_collected_notice_regulation_admission_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        queue_consume_trace=queue_trace,
        recovered_owner_text_by_unit=recovered_owner_text_by_unit,
        generated_by=generated_by,
        evidence_refs={
            "searchable_preview": str(searchable_notice_preview_path),
            "multimodal_inventory": str(multimodal_candidate_inventory_path),
            "queue_consume_trace": str(queue_consume_trace_path or ""),
            "owner_text_execution_report": str(owner_text_execution_report_path or ""),
        },
    )


def build_collected_notice_regulation_admission_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_consume_trace: Mapping[str, Any] | None = None,
    recovered_owner_text_by_unit: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_regulation_admission",
    evidence_refs: Mapping[str, str] | None = None,
) -> CollectedNoticeRegulationAdmissionPreview:
    timestamp = generated_at or utc_now()
    queue_trace_by_unit_id = _queue_trace_by_unit_id(queue_consume_trace)
    units = _select_regulation_candidate_units(
        searchable_notice_preview=searchable_notice_preview,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        queue_trace_by_unit_id=queue_trace_by_unit_id,
    )
    units = _apply_recovered_owner_text_to_units(
        units=units,
        recovered_owner_text_by_unit=recovered_owner_text_by_unit or {},
    )
    decisions = _build_decisions(
        units=units,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        queue_trace_by_unit_id=queue_trace_by_unit_id,
    )
    admission_manifest = _admission_manifest(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
        evidence_refs=dict(evidence_refs or {}),
    )
    candidate_audit = _candidate_audit(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
    )
    rejected_deferred = _rejected_deferred_source_report(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    source_trace = _source_to_searchable_trace(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
    )
    return CollectedNoticeRegulationAdmissionPreview(
        admission_manifest=admission_manifest,
        candidate_audit=candidate_audit,
        rejected_deferred_source_report=rejected_deferred,
        source_to_searchable_trace=source_trace,
    )


def preview_to_output_files(
    preview: CollectedNoticeRegulationAdmissionPreview,
) -> dict[str, dict[str, Any]]:
    return {
        "regulation-consumer-admission-manifest.json": preview.admission_manifest,
        "regulation-candidate-audit.json": preview.candidate_audit,
        "regulation-rejected-deferred-source-report.json": (
            preview.rejected_deferred_source_report
        ),
        "regulation-source-to-searchable-trace.json": preview.source_to_searchable_trace,
    }


def build_recovered_owner_text_by_unit_from_execution_report(
    *,
    execution_report: Mapping[str, Any],
    object_store: RegulationOwnerTextObjectStoreReader,
) -> dict[str, dict[str, Any]]:
    recovered: dict[str, dict[str, Any]] = {}
    for result in _mapping_rows(execution_report.get("attempt_results")):
        if str(result.get("status") or "") != "succeeded":
            continue
        if str(result.get("owner_text_status") or "") != "ready":
            continue
        unit_id = str(result.get("searchable_unit_id") or "").strip()
        if not unit_id:
            continue
        refs = result.get("written_refs")
        if not isinstance(refs, Mapping):
            continue
        merge_ref = refs.get("searchable_merge_input")
        plain_text_ref = refs.get("plain_text")
        owner_text = ""
        if isinstance(merge_ref, Mapping):
            owner_text = _read_owner_text_from_searchable_merge_input(
                object_store=object_store,
                ref=merge_ref,
            )
        if not owner_text and isinstance(plain_text_ref, Mapping):
            owner_text = _read_owner_text_from_plain_text_ref(
                object_store=object_store,
                ref=plain_text_ref,
            )
        if not owner_text.strip():
            continue
        recovered[unit_id] = {
            "owner_text": owner_text.strip(),
            "written_refs": {
                key: dict(value) for key, value in refs.items() if isinstance(value, Mapping)
            },
            "provider": result.get("provider"),
            "model": result.get("model"),
            "owner_text_length": result.get("owner_text_length"),
            "owner_text_sha256": result.get("owner_text_sha256"),
            "source_notice_id": result.get("source_notice_id"),
        }
    return recovered


def _select_regulation_candidate_units(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_by_unit_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    for row in searchable_notice_preview.get("units") or ():
        if not isinstance(row, Mapping):
            continue
        unit = dict(row)
        unit_id = str(unit.get("unit_id") or "")
        if queue_trace_by_unit_id and unit_id not in queue_trace_by_unit_id:
            continue
        if not _looks_like_regulation_candidate(unit, multimodal_candidate_inventory):
            continue
        units.append(unit)
    return sorted(
        units,
        key=lambda item: (
            str(item.get("source_surface") or ""),
            str(item.get("site_id") or ""),
            str(item.get("source_notice_id") or ""),
            str(item.get("unit_id") or ""),
        ),
    )


def _apply_recovered_owner_text_to_units(
    *,
    units: Sequence[Mapping[str, Any]],
    recovered_owner_text_by_unit: Mapping[str, Any],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for unit in units:
        unit_id = str(unit.get("unit_id") or "").strip()
        recovered = _coerce_recovered_owner_text_payload(recovered_owner_text_by_unit.get(unit_id))
        if recovered is None:
            enriched.append(dict(unit))
            continue
        owner_text = recovered["owner_text"]
        updated = dict(unit)
        updated["body_text"] = owner_text
        updated["body_excerpt"] = owner_text[:240]
        updated["search_text"] = "\n".join(
            part
            for part in (
                str(updated.get("title") or "").strip(),
                owner_text,
            )
            if part
        )
        updated["multimodal_status"] = "completed"
        updated["owner_text_status"] = "ready"
        updated["owner_text_recovery"] = {
            key: value for key, value in recovered.items() if key != "owner_text"
        }
        enriched.append(updated)
    return enriched


def _build_decisions(
    *,
    units: Sequence[Mapping[str, Any]],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_by_unit_id: Mapping[str, Mapping[str, Any]],
) -> list[_RegulationDecision]:
    decisions: list[_RegulationDecision] = []
    primary_by_candidate_key: dict[str, _RegulationDecision] = {}
    for unit in units:
        decision = _initial_decision(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
            queue_trace_row=queue_trace_by_unit_id.get(str(unit.get("unit_id") or "")),
        )
        if decision.admitted and decision.candidate_key:
            primary = primary_by_candidate_key.get(decision.candidate_key)
            if primary is None:
                primary_by_candidate_key[decision.candidate_key] = decision
            else:
                decision = _duplicate_hold_decision(decision, primary)
        decisions.append(decision)
    return decisions


def _initial_decision(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_row: Mapping[str, Any] | None,
) -> _RegulationDecision:
    reasons: list[str] = []
    title = _regulation_title(unit)
    issuing_org = _issuing_org(unit)
    body_text = str(unit.get("body_text") or "").strip()
    source_refs = list(unit.get("source_object_refs") or ())
    if not str(unit.get("unit_id") or "").strip():
        reasons.append("missing_searchable_unit_id")
    if not source_refs:
        reasons.append("missing_source_object_refs")
    if reasons:
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_INVALID_CAPTURE,
            consumption_class="invalid_capture",
            reason_codes=reasons,
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
        )
    if _multimodal_not_ready(unit, multimodal_candidate_inventory):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_NEEDS_MULTIMODAL,
            consumption_class="needs_multimodal",
            reason_codes=("multimodal_not_ready",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
        )
    if _looks_like_wrapper_notice(unit) and not _has_regulation_body_structure(body_text):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_WRAPPER_ONLY,
            consumption_class="search_only",
            reason_codes=("wrapper_notice_not_canonical_text",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
        )
    if _looks_like_draft_or_operational_scheme(unit):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
        )
    if not title or not body_text or not _has_regulation_body_structure(body_text):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
        )
    if not _has_formal_owner_title(unit):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
        )
    target_collection = _target_collection_for_text(unit)
    if target_collection == SCOPED_TARGET_COLLECTION:
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_SCOPED,
            consumption_class="downstream_admitted",
            reason_codes=("scoped_rule_candidate_detected",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=target_collection,
            queue_trace_row=queue_trace_row,
        )
    return _decision(
        unit=unit,
        regulation_admission_class=REGULATION_CLASS_INSTITUTIONAL,
        consumption_class="downstream_admitted",
        reason_codes=("institutional_rule_candidate_detected",),
        regulation_title=title,
        issuing_org=issuing_org,
        target_collection=INSTITUTIONAL_TARGET_COLLECTION,
        queue_trace_row=queue_trace_row,
    )


def _decision(
    *,
    unit: Mapping[str, Any],
    regulation_admission_class: str,
    consumption_class: str,
    reason_codes: Sequence[str],
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
    queue_trace_row: Mapping[str, Any] | None,
    duplicate_primary_source_notice_id: str | None = None,
    duplicate_primary_searchable_unit_id: str | None = None,
) -> _RegulationDecision:
    candidate_key = (
        _candidate_key(
            regulation_title=regulation_title,
            issuing_org=issuing_org,
            target_collection=target_collection,
        )
        if regulation_title and target_collection
        else None
    )
    target_identity_preview = (
        _target_identity_preview(
            regulation_title=regulation_title,
            issuing_org=issuing_org,
            target_collection=target_collection,
        )
        if regulation_admission_class in {REGULATION_CLASS_INSTITUTIONAL, REGULATION_CLASS_SCOPED}
        and regulation_title
        and target_collection
        else None
    )
    target_surface = (
        f"regulations/{target_collection}"
        if target_identity_preview and target_collection
        else None
    )
    normalized_reason_codes = tuple(dict.fromkeys(str(item) for item in reason_codes if str(item)))
    if _owner_text_status(unit) == "ready":
        normalized_reason_codes = tuple(
            dict.fromkeys((*normalized_reason_codes, "owner_text_recovered"))
        )
    return _RegulationDecision(
        unit=unit,
        regulation_admission_class=regulation_admission_class,
        consumption_class=consumption_class,
        reason_codes=normalized_reason_codes,
        candidate_key=candidate_key,
        regulation_title=regulation_title,
        issuing_org=issuing_org,
        target_collection=target_collection,
        target_surface=target_surface,
        target_identity_preview=target_identity_preview,
        duplicate_primary_source_notice_id=duplicate_primary_source_notice_id,
        duplicate_primary_searchable_unit_id=duplicate_primary_searchable_unit_id,
        queue_trace_row=queue_trace_row,
    )


def _duplicate_hold_decision(
    decision: _RegulationDecision,
    primary: _RegulationDecision,
) -> _RegulationDecision:
    return _decision(
        unit=decision.unit,
        regulation_admission_class=REGULATION_CLASS_DUPLICATE_HOLD,
        consumption_class="search_only",
        reason_codes=("duplicate_regulation_candidate",),
        regulation_title=decision.regulation_title,
        issuing_org=decision.issuing_org,
        target_collection=decision.target_collection,
        queue_trace_row=decision.queue_trace_row,
        duplicate_primary_source_notice_id=str(primary.unit.get("source_notice_id") or ""),
        duplicate_primary_searchable_unit_id=str(primary.unit.get("unit_id") or ""),
    )


def _admission_manifest(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    entries = [_admission_entry(decision) for decision in decisions]
    class_counts = Counter(entry["regulation_admission_class"] for entry in entries)
    consumption_counts = Counter(entry["consumption_class"] for entry in entries)
    target_collection_counts = Counter(
        entry.get("target_collection") or "none" for entry in entries
    )
    return {
        "schema_version": ADMISSION_SCHEMA_VERSION,
        "batch_id": "phase6-r1-regulation-candidate-admission",
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_notice_ids": [entry["source_notice_id"] for entry in entries],
            "target": REGULATION_TARGET,
            "queue_backed": queue_backed,
        },
        "baseline": "captured_but_not_imported",
        "selection_policy": {
            "name": "phase6-r1-regulation-candidate-admission",
            "version": "v1",
            "queue_backed_required": queue_backed,
        },
        "entries": entries,
        "counts": {
            "entry_count": len(entries),
            "downstream_admitted": consumption_counts.get("downstream_admitted", 0),
            "search_only": consumption_counts.get("search_only", 0),
            "defer": consumption_counts.get("defer", 0),
            "needs_multimodal": consumption_counts.get("needs_multimodal", 0),
            "invalid_capture": consumption_counts.get("invalid_capture", 0),
            "by_regulation_admission_class": dict(sorted(class_counts.items())),
            "by_target_collection": dict(sorted(target_collection_counts.items())),
        },
        "evidence_refs": {
            "searchable_preview": evidence_refs.get("searchable_preview", ""),
            "multimodal_inventory": evidence_refs.get("multimodal_inventory", ""),
            "queue_consume_trace": evidence_refs.get("queue_consume_trace", ""),
            "owner_text_execution_report": evidence_refs.get("owner_text_execution_report", ""),
        },
    }


def _admission_entry(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
    return {
        "entry_id": f"notice:{unit.get('site_id')}:{unit.get('source_notice_id')}",
        "source_channel": unit.get("source_channel"),
        "source_surface": unit.get("source_surface"),
        "source_corpus": unit.get("source_corpus"),
        "source_collection": unit.get("source_collection"),
        "site_id": unit.get("site_id"),
        "source_notice_id": unit.get("source_notice_id"),
        "source_document_id": unit.get("source_document_id"),
        "title": unit.get("title"),
        "published_at": unit.get("published_at"),
        "body_excerpt": unit.get("body_excerpt"),
        "source_url": unit.get("source_url"),
        "run_id": dict(unit.get("run_provenance") or {}).get("run_id", ""),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "consumption_class": decision.consumption_class,
        "regulation_admission_class": decision.regulation_admission_class,
        "target": REGULATION_TARGET if decision.admitted else None,
        "target_surface": decision.target_surface,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "candidate_key": decision.candidate_key,
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "target_hints": unit.get("target_hints") or {},
        "multimodal_policy": _multimodal_policy(unit),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        "reason_codes": list(decision.reason_codes),
        "preconditions": _preconditions(decision),
        "searchable_unit_id": unit.get("unit_id"),
    }


def _candidate_audit(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
) -> dict[str, Any]:
    candidates = [_audit_row(decision) for decision in decisions]
    return {
        "schema_version": CANDIDATE_AUDIT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "candidate_count": len(candidates),
        "class_counts": dict(
            sorted(Counter(row["regulation_admission_class"] for row in candidates).items())
        ),
        "candidates": candidates,
    }


def _audit_row(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "title": unit.get("title"),
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "candidate_key": decision.candidate_key,
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "reason_codes": list(decision.reason_codes),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "source_url": unit.get("source_url"),
    }


def _rejected_deferred_source_report(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    entries = []
    for decision in decisions:
        if decision.admitted:
            continue
        unit = decision.unit
        entries.append(
            {
                "source_notice_id": unit.get("source_notice_id"),
                "candidate_target": REGULATION_TARGET,
                "regulation_admission_class": decision.regulation_admission_class,
                "consumption_class": decision.consumption_class,
                "reason_codes": list(decision.reason_codes),
                "searchable_exists": bool(unit.get("unit_id")),
                "source_object_ref_count": len(unit.get("source_object_refs") or ()),
                "multimodal_processing_could_change_decision": (
                    decision.regulation_admission_class == REGULATION_CLASS_NEEDS_MULTIMODAL
                ),
                "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
            }
        )
    return {
        "schema_version": REJECTED_DEFERRED_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_to_searchable_trace(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
) -> dict[str, Any]:
    entries = [_source_trace_entry(decision) for decision in decisions]
    return {
        "schema_version": SOURCE_TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_trace_entry(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
    queue_trace_row = dict(decision.queue_trace_row or {})
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "source_url": unit.get("source_url"),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "queue_job_id": queue_trace_row.get("job_id"),
        "queue_replay_batch_id": queue_trace_row.get("replay_batch_id"),
        "queue_source_object_refs": list(queue_trace_row.get("source_object_refs") or ()),
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "candidate_key": decision.candidate_key,
        "target_identity_preview": decision.target_identity_preview,
        "owner_text_status": _owner_text_status(unit),
    }


def _looks_like_regulation_candidate(
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> bool:
    if _has_strong_classified_regulation_route(unit):
        return True
    if _has_formal_owner_title(unit) and _has_source_owned_regulation_surface(unit):
        return True
    if _looks_like_wrapper_notice(unit) and _wrapper_notice_names_formal_regulation(unit):
        return True
    if _has_regulation_body_structure(str(unit.get("body_text") or "")) and _has_formal_owner_title(
        unit
    ):
        return True
    unit_id = str(unit.get("unit_id") or "")
    for row in multimodal_candidate_inventory.get("candidates") or ():
        if not isinstance(row, Mapping):
            continue
        if str(row.get("unit_id") or "") != unit_id:
            continue
        raw_hints = row.get("target_hints") or ()
        if (
            any(str(item).strip() == REGULATION_TARGET for item in raw_hints)
            and _has_formal_owner_title(unit)
            and _has_source_owned_regulation_surface(unit)
        ):
            return True
    return False


def _has_strong_classified_regulation_route(unit: Mapping[str, Any]) -> bool:
    if REGULATION_TARGET not in classification_target_candidates(unit):
        return False
    strength = classification_evidence_strength(unit)
    return strength in {"strong", "route_signal"}


def _has_source_owned_regulation_surface(unit: Mapping[str, Any]) -> bool:
    source_surface = str(unit.get("source_surface") or "").strip()
    if source_surface == "file_release":
        return True
    title = str(unit.get("title") or "").strip()
    return "通知" not in title or bool(_extract_quoted_title(title))


def _wrapper_notice_names_formal_regulation(unit: Mapping[str, Any]) -> bool:
    title = str(unit.get("title") or "").strip()
    quoted_title = _extract_quoted_title(title)
    return bool(quoted_title and _contains_regulation_keyword(quoted_title))


def _target_hints(unit: Mapping[str, Any]) -> list[str]:
    hints = unit.get("target_hints")
    if not isinstance(hints, Mapping):
        return []
    values = hints.get("candidate_targets")
    if not isinstance(values, list | tuple):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _multimodal_not_ready(
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> bool:
    if _owner_text_status(unit) == "ready":
        return False
    if _multimodal_policy(unit) in {"pending", "failed"}:
        return True
    unit_id = str(unit.get("unit_id") or "")
    for row in multimodal_candidate_inventory.get("candidates") or ():
        if not isinstance(row, Mapping):
            continue
        if str(row.get("unit_id") or "") != unit_id:
            continue
        if str(row.get("status") or "") in {"pending", "failed"}:
            return True
    return False


def _multimodal_policy(unit: Mapping[str, Any]) -> str:
    if _owner_text_status(unit) == "ready":
        return "completed"
    status = str(unit.get("multimodal_status") or "").strip()
    if status in {"not_required", "pending", "completed", "failed"}:
        return status
    return "not_required"


def _owner_text_status(unit: Mapping[str, Any]) -> str:
    status = str(unit.get("owner_text_status") or "").strip()
    if status == "ready":
        return "ready"
    return "not_ready"


def _looks_like_wrapper_notice(unit: Mapping[str, Any]) -> bool:
    title = str(unit.get("title") or "").strip()
    body = str(unit.get("body_text") or "").strip()
    combined = "\n".join((title, body))
    if any(title.startswith(prefix) for prefix in _WRAPPER_NOTICE_PREFIXES):
        return True
    if "通知" in title and _QUOTE_TITLE_RE.search(title):
        return True
    return bool(unit.get("attachment_refs")) and any(
        keyword in combined for keyword in _WRAPPER_NOTICE_KEYWORDS
    )


def _looks_like_draft_or_operational_scheme(unit: Mapping[str, Any]) -> bool:
    text = _policy_text(unit)
    return any(keyword in text for keyword in _DRAFT_OR_SCHEME_KEYWORDS)


def _has_formal_owner_title(unit: Mapping[str, Any]) -> bool:
    source_title = str(unit.get("title") or "").strip()
    quoted_title = _extract_quoted_title(source_title)
    if quoted_title:
        return _contains_regulation_keyword(quoted_title)
    if "通知" in source_title:
        return False
    if source_title.endswith(("公示", "提醒", "公告", "安排")):
        return False
    return _contains_regulation_keyword(source_title)


def _target_collection_for_text(unit: Mapping[str, Any]) -> str:
    text = _policy_text(unit)
    if any(keyword in text for keyword in _ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS):
        return SCOPED_TARGET_COLLECTION
    if any(keyword in text for keyword in _TIME_BOUND_OPERATIONAL_KEYWORDS):
        return SCOPED_TARGET_COLLECTION
    return INSTITUTIONAL_TARGET_COLLECTION


def _has_regulation_body_structure(body: str) -> bool:
    if not body.strip():
        return False
    return any(
        pattern.search(body) is not None
        for pattern in (
            _ARTICLE_MARKER_RE,
            _SECTION_MARKER_RE,
            _SUBSECTION_MARKER_RE,
            _NUMERIC_LIST_MARKER_RE,
        )
    )


def _coerce_recovered_owner_text_payload(value: object) -> dict[str, Any] | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return {"owner_text": text}
    if not isinstance(value, Mapping):
        return None
    text = str(value.get("owner_text") or value.get("text") or "").strip()
    if not text:
        return None
    return {"owner_text": text, **{str(key): item for key, item in value.items()}}


def _read_owner_text_from_searchable_merge_input(
    *,
    object_store: RegulationOwnerTextObjectStoreReader,
    ref: Mapping[str, Any],
) -> str:
    data = object_store.get_bytes(
        bucket=_required_ref_text(ref, "bucket"),
        key=_required_ref_text(ref, "key"),
    )
    payload = json.loads(data.decode("utf-8"))
    if not isinstance(payload, Mapping):
        return ""
    return str(payload.get("owner_text") or "").strip()


def _read_owner_text_from_plain_text_ref(
    *,
    object_store: RegulationOwnerTextObjectStoreReader,
    ref: Mapping[str, Any],
) -> str:
    data = object_store.get_bytes(
        bucket=_required_ref_text(ref, "bucket"),
        key=_required_ref_text(ref, "key"),
    )
    texts: list[str] = []
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            continue
        text = str(payload.get("text") or "").strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def _required_ref_text(ref: Mapping[str, Any], key: str) -> str:
    value = str(ref.get(key) or "").strip()
    if not value:
        raise ValueError(f"owner text ref missing {key}")
    return value


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _contains_regulation_keyword(text: str) -> bool:
    return any(keyword in text for keyword in _FORMAL_REGULATION_KEYWORDS)


def _regulation_title(unit: Mapping[str, Any]) -> str | None:
    title = _clean_title(str(unit.get("title") or ""))
    body = str(unit.get("body_text") or "")
    for candidate in (
        _extract_quoted_title(title),
        title,
        _extract_quoted_title(body),
    ):
        cleaned = _clean_title(candidate or "")
        if cleaned:
            return cleaned
    return None


def _extract_quoted_title(value: str | None) -> str | None:
    if value is None:
        return None
    match = _QUOTE_TITLE_RE.search(value)
    if match is None:
        return None
    return match.group(1).strip() or None


def _clean_title(value: str) -> str:
    cleaned = str(value or "").strip()
    cleaned = re.sub(r"^\s*附件\s*\d*\s*[:：、.-]?\s*", "", cleaned)
    return _FILENAME_SUFFIX_RE.sub("", cleaned).strip()


def _issuing_org(unit: Mapping[str, Any]) -> str:
    text = _policy_text(unit)
    if "中央民族大学" in text:
        return "中央民族大学"
    return "中央民族大学"


def _candidate_key(
    *,
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
) -> str | None:
    if not regulation_title or not target_collection:
        return None
    digest = hashlib.sha256(
        "\n".join(
            (
                _normalize_text_match(regulation_title),
                issuing_org.strip(),
                f"regulations/{target_collection}",
            )
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"regulation-candidate:{target_collection}:{digest}"


def _target_identity_preview(
    *,
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
) -> str | None:
    if not regulation_title or not target_collection:
        return None
    return build_institutional_regulation_document_id(
        regulation_title_normalized=regulation_title,
        regulation_work_title=regulation_title,
        issuing_org=issuing_org,
        semantic_scope=f"regulations/{target_collection}",
    )


def _normalize_text_match(value: str | None) -> str:
    if value is None:
        return ""
    return _TEXT_MATCH_NORMALIZE_RE.sub("", value)


def _policy_text(unit: Mapping[str, Any]) -> str:
    return "\n".join(
        str(unit.get(key) or "") for key in ("title", "body_text", "body_excerpt", "search_text")
    )


def _preconditions(decision: _RegulationDecision) -> list[str]:
    if not decision.admitted:
        return []
    return [
        "searchable_unit_present",
        "source_object_refs_present",
        "regulation_candidate_audit_passed",
        "no_current_promotion",
        "phase6r2_gated_materialization_required",
    ]


def _queue_trace_by_unit_id(
    queue_consume_trace: Mapping[str, Any] | None,
) -> dict[str, Mapping[str, Any]]:
    if not queue_consume_trace:
        return {}
    rows_by_unit: dict[str, Mapping[str, Any]] = {}
    for row in queue_consume_trace.get("trace_rows") or ():
        if not isinstance(row, Mapping):
            continue
        for unit_id in row.get("searchable_unit_refs") or ():
            normalized = str(unit_id or "").strip()
            if normalized:
                rows_by_unit[normalized] = row
    return rows_by_unit


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_06_R1_ID",
    "CollectedNoticeRegulationAdmissionPreview",
    "RegulationOwnerTextObjectStoreReader",
    "build_collected_notice_regulation_admission_preview",
    "build_collected_notice_regulation_admission_preview_from_paths",
    "build_recovered_owner_text_by_unit_from_execution_report",
    "preview_to_output_files",
]
