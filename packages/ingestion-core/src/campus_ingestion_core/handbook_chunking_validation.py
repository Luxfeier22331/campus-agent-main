from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
import os
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.chunking import (
    ChunkProfile,
    TABLE_UNIT_TYPES,
    build_student_handbook_chunk_profile,
    clean_structured_text,
    estimate_token_count,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import DEFAULT_BUCKET_PROCESSED, ObjectStoreSettings
from campus_ingestion_core.split_manifest import load_split_manifest


DEFAULT_HANDBOOK_MANIFEST_PATH = Path("configs/ingestion/regulations/student_handbook/split-manifest.v1.json")
HANDBOOK_SCOPE = ("regulations", "student_handbook")
PARENT_UNIT_TYPES = {"article_body", "policy_page"}


class ChunkValidationArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ChunkValidationFailure:
    document_id: str
    title: str
    artifact_key: str | None
    error: str


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkingValidationReport:
    passed: bool
    chunk_policy_version: str
    tokenizer_name: str
    manifest_document_count: int
    registry_record_count: int
    registry_unique_document_count: int
    selected_source_faithful_record_count: int
    validated_document_count: int
    total_units: int
    total_chunks: int
    avg_units_per_document: float
    avg_chunks_per_document: float
    max_chunks_in_document: int
    min_chunks_in_document: int
    extra_registry_document_ids: tuple[str, ...]
    missing_registry_document_ids: tuple[str, ...]
    read_failures: tuple[ChunkValidationFailure, ...]
    chunk_failures: tuple[ChunkValidationFailure, ...]
    empty_document_ids: tuple[str, ...]
    non_table_oversize_chunk_count: int
    polluted_section_path_count: int
    missing_contextualization_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    boundary_rule_counts: dict[str, int]
    oversize_parent_unit_counts: dict[str, int]
    oversize_multiline_parent_unit_counts: dict[str, int]
    structure_eligible_unit_counts: dict[str, int]
    chunk_token_histogram: dict[str, int]


def validate_student_handbook_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
) -> StudentHandbookChunkingValidationReport:
    source = dict(env if env is not None else os.environ)
    corpus, collection = HANDBOOK_SCOPE
    runtime_profile = chunk_profile or _resolve_validation_chunk_profile(source, corpus=corpus, collection=collection)
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    processed_bucket = (source.get("OBJECT_STORE_BUCKET_PROCESSED") or DEFAULT_BUCKET_PROCESSED).strip()
    if not processed_bucket:
        processed_bucket = DEFAULT_BUCKET_PROCESSED
    split_manifest_path = _resolve_manifest_path(source=source, manifest_path=manifest_path)

    manifest = load_split_manifest(
        split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    manifest_ids = {document.document_id for document in manifest.documents}
    manifest_titles = {document.document_id: document.title for document in manifest.documents}

    records = runtime_registry.list_by_scope(corpus, collection)
    records_by_doc: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        records_by_doc.setdefault(record.document_id, []).append(record)

    selected_records = _select_source_faithful_records(records_by_doc)
    extra_registry_document_ids = tuple(sorted(set(records_by_doc) - manifest_ids))
    missing_registry_document_ids = tuple(sorted(manifest_ids - set(records_by_doc)))

    read_failures: list[ChunkValidationFailure] = []
    chunk_failures: list[ChunkValidationFailure] = []
    empty_document_ids: list[str] = []
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    boundary_rule_counts: Counter[str] = Counter()
    oversize_parent_unit_counts: Counter[str] = Counter()
    oversize_multiline_parent_unit_counts: Counter[str] = Counter()
    structure_eligible_unit_counts: Counter[str] = Counter()
    chunk_counts_per_doc: list[int] = []
    total_units = 0
    non_table_oversize_chunk_count = 0
    polluted_section_path_count = 0
    missing_contextualization_count = 0
    chunk_token_histogram: Counter[str] = Counter()

    for record in selected_records:
        title = manifest_titles.get(record.document_id, record.document_id)
        if not record.document_units_object_key:
            read_failures.append(
                ChunkValidationFailure(
                    document_id=record.document_id,
                    title=title,
                    artifact_key=None,
                    error="document_units_object_key is missing",
                )
            )
            continue
        try:
            structured_jsonl_bytes = runtime_object_store.get_bytes(
                bucket=processed_bucket,
                key=record.document_units_object_key,
            )
        except Exception as exc:
            read_failures.append(
                ChunkValidationFailure(
                    document_id=record.document_id,
                    title=title,
                    artifact_key=record.document_units_object_key,
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
            continue

        rows = [json.loads(line) for line in structured_jsonl_bytes.decode("utf-8").splitlines() if line.strip()]
        total_units += len(rows)
        polluted_section_path_count += sum(1 for row in rows if _has_polluted_section_path(row))
        _collect_structure_stats(
            rows=rows,
            chunk_profile=runtime_profile,
            unit_type_counts=unit_type_counts,
            oversize_parent_unit_counts=oversize_parent_unit_counts,
            oversize_multiline_parent_unit_counts=oversize_multiline_parent_unit_counts,
            structure_eligible_unit_counts=structure_eligible_unit_counts,
        )
        try:
            chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_jsonl_bytes,
                chunk_profile=runtime_profile,
            )
        except Exception as exc:
            chunk_failures.append(
                ChunkValidationFailure(
                    document_id=record.document_id,
                    title=title,
                    artifact_key=record.document_units_object_key,
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
            continue
        if not chunks:
            empty_document_ids.append(record.document_id)
        chunk_counts_per_doc.append(len(chunks))
        for chunk in chunks:
            split_reason_counts[str(chunk.metadata.get("split_reason") or "none")] += 1
            boundary_rule_counts[str(chunk.metadata.get("boundary_rule") or "none")] += 1
            if _chunk_requires_context(chunk) and not bool(chunk.metadata.get("contextualized_text")):
                missing_contextualization_count += 1
            token_count = estimate_token_count(chunk.text, chunk_profile=runtime_profile)
            chunk_token_histogram[_histogram_bucket(token_count)] += 1
            if str(chunk.metadata.get("unit_type") or "") not in TABLE_UNIT_TYPES and token_count > runtime_profile.max_chunk_size:
                non_table_oversize_chunk_count += 1

    total_chunks = sum(chunk_counts_per_doc)
    validated_document_count = len(chunk_counts_per_doc)
    passed = not (
        extra_registry_document_ids
        or missing_registry_document_ids
        or read_failures
        or chunk_failures
        or empty_document_ids
        or non_table_oversize_chunk_count
        or polluted_section_path_count
        or missing_contextualization_count
    )
    return StudentHandbookChunkingValidationReport(
        passed=passed,
        chunk_policy_version=runtime_profile.chunk_policy_version,
        tokenizer_name=runtime_profile.tokenizer_name,
        manifest_document_count=len(manifest.documents),
        registry_record_count=len(records),
        registry_unique_document_count=len(records_by_doc),
        selected_source_faithful_record_count=len(selected_records),
        validated_document_count=validated_document_count,
        total_units=total_units,
        total_chunks=total_chunks,
        avg_units_per_document=round(total_units / validated_document_count, 2) if validated_document_count else 0.0,
        avg_chunks_per_document=round(total_chunks / validated_document_count, 2)
        if validated_document_count
        else 0.0,
        max_chunks_in_document=max(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        min_chunks_in_document=min(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        extra_registry_document_ids=extra_registry_document_ids,
        missing_registry_document_ids=missing_registry_document_ids,
        read_failures=tuple(read_failures),
        chunk_failures=tuple(chunk_failures),
        empty_document_ids=tuple(sorted(empty_document_ids)),
        non_table_oversize_chunk_count=non_table_oversize_chunk_count,
        polluted_section_path_count=polluted_section_path_count,
        missing_contextualization_count=missing_contextualization_count,
        unit_type_counts=dict(unit_type_counts),
        split_reason_counts=dict(split_reason_counts),
        boundary_rule_counts=dict(boundary_rule_counts),
        oversize_parent_unit_counts=dict(oversize_parent_unit_counts),
        oversize_multiline_parent_unit_counts=dict(oversize_multiline_parent_unit_counts),
        structure_eligible_unit_counts=dict(structure_eligible_unit_counts),
        chunk_token_histogram=dict(chunk_token_histogram),
    )


def _resolve_manifest_path(*, source: dict[str, str], manifest_path: Path | None) -> Path:
    if manifest_path is not None:
        return Path(manifest_path)
    configured = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
    if configured:
        return Path(configured)
    return DEFAULT_HANDBOOK_MANIFEST_PATH


def _resolve_validation_chunk_profile(
    source: dict[str, str],
    *,
    corpus: str,
    collection: str,
) -> ChunkProfile:
    runtime_profile = load_runtime_profile(corpus, collection)
    model_name = (
        source.get("INGESTION_EMBEDDING_MODEL")
        or source.get("EMBEDDING_MODEL")
        or ""
    ).strip()
    return build_student_handbook_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=model_name or None,
    )


def _select_source_faithful_records(
    records_by_doc: dict[str, list[DocumentRegistryRecord]],
) -> tuple[DocumentRegistryRecord, ...]:
    selected_records: list[DocumentRegistryRecord] = []
    for document_id in sorted(records_by_doc):
        doc_records = records_by_doc[document_id]
        preferred = [record for record in doc_records if record.is_current and record.revision_track == "source-faithful"]
        if preferred:
            selected_records.append(max(preferred, key=lambda record: record.ingestion_timestamp))
            continue
        source_faithful = [record for record in doc_records if record.revision_track == "source-faithful"]
        if source_faithful:
            selected_records.append(max(source_faithful, key=lambda record: record.ingestion_timestamp))
    return tuple(selected_records)


def _collect_structure_stats(
    *,
    rows: list[dict[str, object]],
    chunk_profile: ChunkProfile,
    unit_type_counts: Counter[str],
    oversize_parent_unit_counts: Counter[str],
    oversize_multiline_parent_unit_counts: Counter[str],
    structure_eligible_unit_counts: Counter[str],
) -> None:
    strategy = chunk_profile.strategy
    for row in rows:
        unit_type = str(row.get("unit_type") or "")
        unit_type_counts[unit_type] += 1
        if unit_type not in PARENT_UNIT_TYPES:
            continue
        text = str(row.get("clean_text") or "")
        cleaned_text = clean_structured_text(unit_type=unit_type, text=text)
        token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
        if token_count <= chunk_profile.max_chunk_size:
            continue
        oversize_parent_unit_counts[unit_type] += 1
        lines = [line.strip() for line in cleaned_text.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        oversize_multiline_parent_unit_counts[unit_type] += 1
        if strategy is None:
            continue
        result = strategy.split_structure_boundaries(
            unit_type=unit_type,
            text=cleaned_text,
            chunk_profile=chunk_profile,
        )
        if result is not None:
            structure_eligible_unit_counts[result.boundary_rule] += 1


def _histogram_bucket(token_count: int) -> str:
    if token_count < 100:
        return "lt_100"
    if token_count < 250:
        return "100_249"
    if token_count < 500:
        return "250_499"
    return "ge_500"


def _has_polluted_section_path(row: dict[str, object]) -> bool:
    anchor = row.get("anchor")
    if not isinstance(anchor, dict):
        return False
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list) or not section_path:
        return False
    if anchor.get("provision_label") is not None:
        return False
    tail = str(section_path[-1] or "").strip()
    clean_text = str(row.get("clean_text") or "").strip()
    if not tail or not clean_text:
        return False
    return tail == clean_text and tail.endswith(("。", "！", "？", "；"))


def _chunk_requires_context(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    unit_type = str(metadata.get("unit_type") or "")
    if unit_type in TABLE_UNIT_TYPES:
        return False
    return bool(metadata.get("title"))


__all__ = [
    "ChunkValidationArtifactReader",
    "ChunkValidationFailure",
    "DEFAULT_HANDBOOK_MANIFEST_PATH",
    "StudentHandbookChunkingValidationReport",
    "validate_student_handbook_chunking",
]
