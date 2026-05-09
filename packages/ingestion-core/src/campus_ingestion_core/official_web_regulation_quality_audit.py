from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import median
from typing import Any

from campus_ingestion_core.chunking import estimate_token_count
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.index_release_acceptance import evaluate_release_chunk_quality
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.official_web_regulation_materialization import (
    build_official_web_regulation_candidate_documents,
    materialize_official_web_regulation_candidates,
)
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry_scope_release_support import (
    resolve_release_chunk_quality_budget,
)
from campus_ingestion_core.settings import ObjectStoreSettings

OFFICIAL_WEB_REGULATION_QUALITY_AUDIT_SCHEMA_VERSION = "official_web_regulation_quality_audit.v1"


@dataclass(frozen=True, slots=True)
class OfficialWebRegulationQualityAuditDocumentReport:
    target_document_id: str
    target_collection: str
    title: str
    title_raw: str
    title_base: str
    title_status_kind: str
    title_status_qualifier: str
    source_url: str
    quality_verdict: str
    wrapper_removed: bool
    suspicious_prefix: bool
    chapter_count: int
    article_count: int
    soft_wrap_repair_count: int
    soft_wrap_residue_count: int
    canonical_line_count: int
    chunk_count: int
    answer_bearing_chunk_count: int
    token_summary: dict[str, int | float]
    issue_codes: tuple[str, ...]
    chunk_issue_counts: dict[str, int]
    examples: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class OfficialWebRegulationQualityAuditReport:
    schema_version: str
    source_truth_output_dir: str
    projection_output_dir: str
    passed: bool
    candidate_count: int
    selected_target_document_count: int
    audited_document_count: int
    total_chunk_count: int
    total_answer_bearing_chunk_count: int
    counts_by_collection: dict[str, int]
    normalization_verdict_counts: dict[str, int]
    title_status_kind_counts: dict[str, int]
    issue_counts: dict[str, int]
    chunk_issue_counts: dict[str, int]
    title_normalized_count: int
    wrapper_removed_count: int
    soft_wrap_repair_count: int
    soft_wrap_residue_document_count: int
    documents: tuple[OfficialWebRegulationQualityAuditDocumentReport, ...]


class _InMemoryObjectStore:
    def __init__(self) -> None:
        self._objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self._objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        self._objects[(bucket, key)] = data

    def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
        exclude_keys: tuple[str, ...] = (),
        include_path_segment_suffix: str | None = None,
    ) -> None:
        excluded = set(exclude_keys)
        for object_key in tuple(self._objects):
            object_bucket, key = object_key
            if object_bucket != bucket or not key.startswith(prefix) or key in excluded:
                continue
            if include_path_segment_suffix is not None and (
                f"--{include_path_segment_suffix}" not in key
                and not key.endswith(include_path_segment_suffix)
            ):
                continue
            del self._objects[object_key]


def audit_official_web_regulation_batch_quality(
    *,
    source_truth_output_dir: Path,
    projection_output_dir: Path,
    declarations_path: Path | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
) -> OfficialWebRegulationQualityAuditReport:
    resolved_source_truth_output_dir = source_truth_output_dir.resolve()
    resolved_projection_output_dir = projection_output_dir.resolve()
    resolved_projection_output_dir.mkdir(parents=True, exist_ok=True)
    settings = object_store_settings or _default_object_store_settings()
    object_store = _InMemoryObjectStore()
    document_registry = InMemoryDocumentRegistry()
    raw_asset_registry = InMemoryRawAssetRegistry()
    materialization_report = materialize_official_web_regulation_candidates(
        source_truth_output_dir=resolved_source_truth_output_dir,
        projection_output_dir=resolved_projection_output_dir,
        work_dir=resolved_projection_output_dir.parent / "materialization-work",
        declarations_path=declarations_path.resolve() if declarations_path is not None else None,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store_settings=settings,
        scope_refresh=True,
    )
    candidate_documents = build_official_web_regulation_candidate_documents(
        projection_output_dir=resolved_projection_output_dir,
    )
    candidate_documents_by_id = {
        str(document["document_id"]): document for document in candidate_documents
    }
    if not materialization_report.materialized_documents:
        raise ValueError("no release-ready official-web regulation documents were materialized")

    documents: list[OfficialWebRegulationQualityAuditDocumentReport] = []
    counts_by_collection: Counter[str] = Counter()
    normalization_verdict_counts: Counter[str] = Counter()
    title_status_kind_counts: Counter[str] = Counter()
    issue_counts: Counter[str] = Counter()
    chunk_issue_counts: Counter[str] = Counter()
    title_normalized_count = 0
    wrapper_removed_count = 0
    soft_wrap_repair_count = 0
    soft_wrap_residue_document_count = 0
    total_chunk_count = 0
    total_answer_bearing_chunk_count = 0

    for materialized_document in materialization_report.materialized_documents:
        target_document_id = str(materialized_document["target_document_id"])
        record = document_registry.current_version(
            target_document_id,
            preferred_revision_tracks=("current-effective",),
        )
        if record is None or not record.document_units_object_key:
            continue
        candidate_document = candidate_documents_by_id.get(target_document_id, {})
        document_report = _build_document_report(
            record=record,
            materialized_document=materialized_document,
            candidate_document=candidate_document,
            object_store=object_store,
            bucket_derived=settings.bucket_derived,
        )
        documents.append(document_report)
        counts_by_collection[document_report.target_collection] += 1
        normalization_verdict_counts[document_report.quality_verdict] += 1
        if document_report.title_status_kind:
            title_status_kind_counts[document_report.title_status_kind] += 1
        if _title_was_normalized(candidate_document):
            title_normalized_count += 1
        if document_report.wrapper_removed:
            wrapper_removed_count += 1
        soft_wrap_repair_count += document_report.soft_wrap_repair_count
        if document_report.soft_wrap_residue_count > 0:
            soft_wrap_residue_document_count += 1
        issue_counts.update(document_report.issue_codes)
        chunk_issue_counts.update(document_report.chunk_issue_counts)
        total_chunk_count += document_report.chunk_count
        total_answer_bearing_chunk_count += document_report.answer_bearing_chunk_count

    passed = not issue_counts
    return OfficialWebRegulationQualityAuditReport(
        schema_version=OFFICIAL_WEB_REGULATION_QUALITY_AUDIT_SCHEMA_VERSION,
        source_truth_output_dir=str(resolved_source_truth_output_dir),
        projection_output_dir=str(resolved_projection_output_dir),
        passed=passed,
        candidate_count=materialization_report.candidate_count,
        selected_target_document_count=len(materialization_report.selected_target_document_ids),
        audited_document_count=len(documents),
        total_chunk_count=total_chunk_count,
        total_answer_bearing_chunk_count=total_answer_bearing_chunk_count,
        counts_by_collection=dict(sorted(counts_by_collection.items())),
        normalization_verdict_counts=dict(sorted(normalization_verdict_counts.items())),
        title_status_kind_counts=dict(sorted(title_status_kind_counts.items())),
        issue_counts=dict(sorted(issue_counts.items())),
        chunk_issue_counts=dict(sorted(chunk_issue_counts.items())),
        title_normalized_count=title_normalized_count,
        wrapper_removed_count=wrapper_removed_count,
        soft_wrap_repair_count=soft_wrap_repair_count,
        soft_wrap_residue_document_count=soft_wrap_residue_document_count,
        documents=tuple(documents),
    )


def _build_document_report(
    *,
    record: DocumentRegistryRecord,
    materialized_document: Mapping[str, Any],
    candidate_document: Mapping[str, Any],
    object_store: _InMemoryObjectStore,
    bucket_derived: str,
) -> OfficialWebRegulationQualityAuditDocumentReport:
    document_units_bytes = object_store.get_bytes(
        bucket=bucket_derived,
        key=record.document_units_object_key or "",
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=document_units_bytes,
    )
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    chunk_budget = resolve_release_chunk_quality_budget(
        corpus=record.corpus,
        collection=record.collection,
        runtime_profile=runtime_profile,
    )
    quality_gate = evaluate_release_chunk_quality(
        chunks=chunks,
        max_token_count=chunk_budget.max_token_count,
        max_token_count_source=chunk_budget.source,
        max_token_count_by_unit_type=chunk_budget.max_token_count_by_unit_type,
        qrels_coverage_required=False,
    )
    normalization_quality = dict(materialized_document.get("normalization_quality") or {})
    quality_verdict = str(normalization_quality.get("quality_verdict") or "").strip() or "unknown"
    title = str(
        materialized_document.get("title")
        or candidate_document.get("title")
        or normalization_quality.get("title_display")
        or ""
    )
    title_raw = str(
        materialized_document.get("title_raw")
        or normalization_quality.get("title_raw")
        or candidate_document.get("title_raw")
        or title
    )
    title_base = str(
        materialized_document.get("title_base")
        or candidate_document.get("title_base")
        or normalization_quality.get("title_base")
        or title
    )
    title_status_kind = str(
        materialized_document.get("title_status_kind")
        or normalization_quality.get("title_status_kind")
        or ""
    ).strip()
    title_status_qualifier = str(
        materialized_document.get("title_status_qualifier")
        or normalization_quality.get("title_status_qualifier")
        or ""
    ).strip()
    canonical_body = str(candidate_document.get("canonical_body") or "").strip()
    issue_codes: list[str] = []
    if quality_verdict != "passed":
        issue_codes.append("normalization_quality_failed")
    if bool(normalization_quality.get("suspicious_prefix")):
        issue_codes.append("suspicious_prefix_residue")
    if int(normalization_quality.get("soft_wrap_residue_count") or 0) > 0:
        issue_codes.append("soft_wrap_residue_present")

    issues_by_chunk_id = quality_gate.summary.get("issues_by_chunk_id")
    chunk_issues = issues_by_chunk_id if isinstance(issues_by_chunk_id, dict) else {}
    chunk_issue_counts = _chunk_issue_counts(chunk_issues)
    issue_codes.extend(sorted(chunk_issue_counts))
    token_counts = [
        int(chunk.metadata.get("final_token_count") or estimate_token_count(chunk.text))
        for chunk in chunks
    ]
    chunk_by_id = {chunk.chunk_id: chunk for chunk in chunks}
    examples = _document_issue_examples(
        quality_verdict=quality_verdict,
        normalization_quality=normalization_quality,
        chunk_issues=chunk_issues,
        chunk_by_id=chunk_by_id,
    )

    return OfficialWebRegulationQualityAuditDocumentReport(
        target_document_id=record.document_id,
        target_collection=record.collection,
        title=title,
        title_raw=title_raw,
        title_base=title_base,
        title_status_kind=title_status_kind,
        title_status_qualifier=title_status_qualifier,
        source_url=str(candidate_document.get("normalized_canonical_url") or record.source_uri),
        quality_verdict=quality_verdict,
        wrapper_removed=bool(normalization_quality.get("wrapper_removed")),
        suspicious_prefix=bool(normalization_quality.get("suspicious_prefix")),
        chapter_count=int(normalization_quality.get("chapter_count") or 0),
        article_count=int(normalization_quality.get("article_count") or 0),
        soft_wrap_repair_count=int(normalization_quality.get("soft_wrap_repair_count") or 0),
        soft_wrap_residue_count=int(normalization_quality.get("soft_wrap_residue_count") or 0),
        canonical_line_count=len([line for line in canonical_body.splitlines() if line.strip()]),
        chunk_count=len(chunks),
        answer_bearing_chunk_count=sum(
            1 for chunk in chunks if bool(chunk.metadata.get("is_answer_bearing"))
        ),
        token_summary=_build_token_summary(token_counts),
        issue_codes=tuple(dict.fromkeys(issue_codes)),
        chunk_issue_counts=chunk_issue_counts,
        examples=examples,
    )


def _title_was_normalized(candidate_document: Mapping[str, Any]) -> bool:
    title = str(candidate_document.get("title") or "").strip()
    title_raw = str(candidate_document.get("title_raw") or "").strip()
    return bool(title and title_raw and title != title_raw)


def _chunk_issue_counts(chunk_issues: Mapping[str, object]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for issues in chunk_issues.values():
        if not isinstance(issues, (list, tuple)):
            continue
        for issue in issues:
            normalized_issue = str(issue).strip()
            if normalized_issue:
                counts[normalized_issue] += 1
    return dict(sorted(counts.items()))


def _document_issue_examples(
    *,
    quality_verdict: str,
    normalization_quality: Mapping[str, Any],
    chunk_issues: Mapping[str, object],
    chunk_by_id: Mapping[str, Any],
) -> tuple[dict[str, object], ...]:
    examples: list[dict[str, object]] = []
    if quality_verdict != "passed":
        examples.append(
            {
                "issue_code": "normalization_quality_failed",
                "quality_verdict": quality_verdict,
                "reason_codes": list(normalization_quality.get("reason_codes") or ()),
            }
        )
    if bool(normalization_quality.get("suspicious_prefix")):
        examples.append(
            {
                "issue_code": "suspicious_prefix_residue",
                "suspicious_prefix": True,
            }
        )
    if int(normalization_quality.get("soft_wrap_residue_count") or 0) > 0:
        examples.append(
            {
                "issue_code": "soft_wrap_residue_present",
                "soft_wrap_residue_count": int(
                    normalization_quality.get("soft_wrap_residue_count") or 0
                ),
            }
        )
    for chunk_id, issues in chunk_issues.items():
        if not isinstance(issues, (list, tuple)):
            continue
        chunk = chunk_by_id.get(str(chunk_id))
        examples.append(
            {
                "issue_code": str(issues[0]),
                "chunk_id": str(chunk_id),
                "issues": [str(issue) for issue in issues],
                "text_excerpt": str(getattr(chunk, "text", ""))[:160],
            }
        )
        if len(examples) >= 5:
            break
    return tuple(examples[:5])


def _build_token_summary(token_counts: list[int]) -> dict[str, int | float]:
    if not token_counts:
        return {"min": 0, "max": 0, "avg": 0.0, "median": 0}
    return {
        "min": min(token_counts),
        "max": max(token_counts),
        "avg": round(sum(token_counts) / len(token_counts), 2),
        "median": int(median(token_counts)),
    }


def _default_object_store_settings() -> ObjectStoreSettings:
    return ObjectStoreSettings(
        endpoint="http://localhost:9000",
        access_key="test",
        secret_key="test",
        region="us-east-1",
        bucket_source="campus-rag-source",
        bucket_derived="campus-rag-derived",
        secure=False,
    )


__all__ = [
    "OFFICIAL_WEB_REGULATION_QUALITY_AUDIT_SCHEMA_VERSION",
    "OfficialWebRegulationQualityAuditDocumentReport",
    "OfficialWebRegulationQualityAuditReport",
    "audit_official_web_regulation_batch_quality",
    "official_web_regulation_quality_audit_report_to_dict",
]


def official_web_regulation_quality_audit_report_to_dict(
    report: OfficialWebRegulationQualityAuditReport,
) -> dict[str, Any]:
    return asdict(report)
