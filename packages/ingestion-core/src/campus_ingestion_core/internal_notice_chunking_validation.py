from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import random
import re
from typing import Literal, Protocol, Sequence

from campus_ingestion_core.authenticated_notice_closeout_staged_documents import (
    load_verified_closeout_run_document_record_pairs,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    CloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    HIGH_RISK_NOTICE_LABELS,
    NOTICE_RISK_LABEL_BODY_ONLY,
    NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
    _aggregate_notice_risk_counts,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.registry_scope_chunk_preparation import load_chunk_preparation_manifest
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


INTERNAL_NOTICE_SCOPE = ("campus_notices", "internal_notice")
DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED = 20260406
_NOTICE_BODY_LANE = "notice_body"
_ATTACHMENT_TEXT_LANE = "attachment_text_extractable"
_ATTACHMENT_OCR_LANE = "attachment_ocr_required"
_TEXTUAL_CHUNK_UNIT_TYPES = frozenset({"article_body", "attachment_body", "section_text", "table_unit"})
_ATTACHMENT_SUBSTANTIVE_CHUNK_UNIT_TYPES = frozenset({"attachment_body", "section_text", "table_unit"})
_ATTACHMENT_OCR_NOISE_UNIT_TYPES = frozenset({"attachment_body", "section_text"})
_ATTACHMENT_LINEAGE_FIELDS = (
    "parent_document_id",
    "attachment_ref_id",
    "attachment_filename",
    "attachment_kind",
    "attachment_role",
    "extraction_class",
)
_MARKUP_LEAK_RE = re.compile(r"<(?:/?[a-zA-Z][^>\n]{0,120}|!--)")
_USEFUL_CHAR_RE = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]")
_NON_SPACE_RE = re.compile(r"\S")
_SAFE_FILENAME_RE = re.compile(r"[^a-z0-9]+")
_NOTICE_BODY_FRAGMENT_FINAL_TOKEN_THRESHOLD = 48
_OCR_HEADER_DOMINANT_RATIO_THRESHOLD = 0.4
_OCR_HEADER_DOMINANT_DISPLAY_TOKEN_THRESHOLD = 80
_OCR_USEFUL_CHAR_RATIO_THRESHOLD = 0.55
_OCR_SHORT_LINE_RATIO_THRESHOLD = 0.6


class InternalNoticeChunkValidationArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkValidationFailure:
    document_id: str
    title: str
    artifact_key: str | None
    error: str


@dataclass(frozen=True, slots=True)
class InternalNoticeValidationInputs:
    source: dict[str, str]
    registry: DocumentRegistry | None
    object_store: InternalNoticeChunkValidationArtifactReader
    derived_bucket: str
    corpus: str
    collection: str
    records: tuple[DocumentRegistryRecord, ...]
    selected_records: tuple[DocumentRegistryRecord, ...]
    selection_mode: Literal["current_scope", "preparation_manifest", "verified_closeout_run"]
    preparation_run_id: str | None
    closeout_run_id: str | None
    missing_manifest_records: tuple[str, ...]
    notice_risk_profiles: dict[str, InternalNoticeNoticeRiskProfile]
    notice_risk_counts: dict[str, int]
    high_risk_notice_count: int


@dataclass(frozen=True, slots=True)
class InternalNoticeNoticeRiskProfile:
    notice_id: str
    notice_risk_label: str
    attachment_mix_score: int
    attachment_ref_count: int
    has_text_table_attachment: bool
    has_spatial_attachment: bool
    has_reference_only_attachment: bool


@dataclass(frozen=True, slots=True)
class InternalNoticeScannedDocument:
    title: str
    lane: str
    notice_id: str
    notice_risk_profile: InternalNoticeNoticeRiskProfile | None
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[IndexableChunk, ...]
    read_failure: InternalNoticeChunkValidationFailure | None = None
    chunk_failure: InternalNoticeChunkValidationFailure | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkingScanResult:
    mode: Literal["full", "samples"]
    inputs: InternalNoticeValidationInputs
    documents: tuple[InternalNoticeScannedDocument, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkingValidationReport:
    passed: bool
    corpus: str
    collection: str
    selection_mode: str
    preparation_run_id: str | None
    closeout_run_id: str | None
    registry_record_count: int
    selected_record_count: int
    validated_document_count: int
    total_units: int
    total_chunks: int
    lane_document_counts: dict[str, int]
    lane_chunk_counts: dict[str, int]
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    notice_risk_counts: dict[str, int]
    high_risk_notice_count: int
    read_failures: tuple[InternalNoticeChunkValidationFailure, ...]
    chunk_failures: tuple[InternalNoticeChunkValidationFailure, ...]
    missing_manifest_records: tuple[str, ...]
    empty_document_ids: tuple[str, ...]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_lane_metadata_count: int
    missing_attachment_lineage_count: int
    attachment_without_body_count: int
    notice_body_fragmentation_count: int
    notice_body_token_guardrail_chunk_count: int
    markup_leak_chunk_count: int
    replacement_character_chunk_count: int
    header_dominant_ocr_chunk_count: int
    noisy_ocr_chunk_count: int


@dataclass(frozen=True, slots=True)
class _InternalNoticeChunkSampleCandidate:
    bucket_name: str
    bucket_reason: str
    document: InternalNoticeScannedDocument


def scan_internal_notice_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: InternalNoticeChunkValidationArtifactReader | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    preparation_run_id: str | None = None,
    closeout_run_id: str | None = None,
    closeout_store: CloseoutStore | None = None,
    mode: Literal["full", "samples"] = "full",
    sample_seed: int = DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
) -> InternalNoticeChunkingScanResult:
    inputs = _build_validation_inputs(
        env=env,
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=source_truth_inventory_store,
        preparation_run_id=preparation_run_id,
        closeout_run_id=closeout_run_id,
        closeout_store=closeout_store,
    )
    documents = _scan_all_documents(inputs=inputs)
    if mode == "samples":
        documents = _pick_sample_documents(documents=documents, sample_seed=sample_seed)
    return InternalNoticeChunkingScanResult(mode=mode, inputs=inputs, documents=documents)


def validate_internal_notice_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: InternalNoticeChunkValidationArtifactReader | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    preparation_run_id: str | None = None,
    closeout_run_id: str | None = None,
    closeout_store: CloseoutStore | None = None,
    scan_result: InternalNoticeChunkingScanResult | None = None,
) -> InternalNoticeChunkingValidationReport:
    runtime_scan = scan_result or scan_internal_notice_chunking(
        env=env,
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=source_truth_inventory_store,
        preparation_run_id=preparation_run_id,
        closeout_run_id=closeout_run_id,
        closeout_store=closeout_store,
        mode="full",
    )
    return build_internal_notice_chunking_validation_report(scan_result=runtime_scan)


def build_internal_notice_chunking_validation_report(
    *,
    scan_result: InternalNoticeChunkingScanResult,
) -> InternalNoticeChunkingValidationReport:
    if scan_result.mode != "full":
        raise ValueError("validation report requires a full internal_notice chunk scan")
    inputs = scan_result.inputs
    read_failures: list[InternalNoticeChunkValidationFailure] = []
    chunk_failures: list[InternalNoticeChunkValidationFailure] = []
    empty_document_ids: list[str] = []
    lane_document_counts: Counter[str] = Counter()
    lane_chunk_counts: Counter[str] = Counter()
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    total_units = 0
    total_chunks = 0
    missing_title_chunk_count = 0
    missing_contextualization_count = 0
    missing_lane_metadata_count = 0
    missing_attachment_lineage_count = 0
    attachment_without_body_count = 0
    notice_body_fragmentation_count = 0
    notice_body_token_guardrail_chunk_count = 0
    markup_leak_chunk_count = 0
    replacement_character_chunk_count = 0
    header_dominant_ocr_chunk_count = 0
    noisy_ocr_chunk_count = 0

    for document in scan_result.documents:
        if document.read_failure is not None:
            read_failures.append(document.read_failure)
            continue
        if document.chunk_failure is not None:
            chunk_failures.append(document.chunk_failure)
            continue
        has_stable_title_source = _document_has_stable_title_source(document.rows)
        lane_document_counts[document.lane] += 1
        total_units += len(document.rows)
        total_chunks += len(document.chunks)
        if not document.chunks:
            empty_document_ids.append(document.record.document_id)
        body_chunk_count = sum(
            1 for chunk in document.chunks if _chunk_unit_type(chunk) in _ATTACHMENT_SUBSTANTIVE_CHUNK_UNIT_TYPES
        )
        if document.lane in {_ATTACHMENT_TEXT_LANE, _ATTACHMENT_OCR_LANE} and body_chunk_count == 0:
            attachment_without_body_count += 1
        for chunk in document.chunks:
            lane_chunk_counts[document.lane] += 1
            unit_type = _chunk_unit_type(chunk)
            unit_type_counts[unit_type] += 1
            split_reason_counts[str(chunk.metadata.get("split_reason") or "none")] += 1
            header_mode_counts[str(chunk.metadata.get("header_mode") or "none")] += 1
            if unit_type not in _TEXTUAL_CHUNK_UNIT_TYPES:
                continue
            if not _resolve_chunk_title(chunk) or not has_stable_title_source:
                missing_title_chunk_count += 1
            if not bool(chunk.metadata.get("contextualized_text")):
                missing_contextualization_count += 1
            chunk_lane = str(chunk.metadata.get("internal_notice_lane") or "").strip()
            if not chunk_lane or chunk_lane != document.lane:
                missing_lane_metadata_count += 1
            if document.lane in {_ATTACHMENT_TEXT_LANE, _ATTACHMENT_OCR_LANE} and not _has_attachment_lineage(chunk):
                missing_attachment_lineage_count += 1
            if _contains_markup_leak(chunk.text) or _contains_markup_leak(_resolve_display_text(chunk)):
                markup_leak_chunk_count += 1
            if "\ufffd" in chunk.text or "\ufffd" in _resolve_display_text(chunk):
                replacement_character_chunk_count += 1
            if document.lane == _NOTICE_BODY_LANE and _is_fragmented_notice_body_chunk(
                chunk=chunk,
                document_chunk_count=len(document.chunks),
            ):
                notice_body_fragmentation_count += 1
            if document.lane == _NOTICE_BODY_LANE and str(chunk.metadata.get("split_reason") or "") == "token_guardrail":
                notice_body_token_guardrail_chunk_count += 1
            if document.lane == _ATTACHMENT_OCR_LANE and _is_header_dominant_ocr_chunk(chunk):
                header_dominant_ocr_chunk_count += 1
            if document.lane == _ATTACHMENT_OCR_LANE and _looks_like_noisy_ocr_chunk(_resolve_display_text(chunk)):
                noisy_ocr_chunk_count += 1

    passed = not (
        read_failures
        or chunk_failures
        or inputs.missing_manifest_records
        or empty_document_ids
        or missing_title_chunk_count
        or missing_contextualization_count
        or missing_lane_metadata_count
        or missing_attachment_lineage_count
        or attachment_without_body_count
        or notice_body_fragmentation_count
        or markup_leak_chunk_count
        or replacement_character_chunk_count
        or header_dominant_ocr_chunk_count
        or noisy_ocr_chunk_count
    )
    return InternalNoticeChunkingValidationReport(
        passed=passed,
        corpus=inputs.corpus,
        collection=inputs.collection,
        selection_mode=inputs.selection_mode,
        preparation_run_id=inputs.preparation_run_id,
        closeout_run_id=inputs.closeout_run_id,
        registry_record_count=len(inputs.records),
        selected_record_count=len(inputs.selected_records),
        validated_document_count=sum(1 for doc in scan_result.documents if doc.read_failure is None and doc.chunk_failure is None),
        total_units=total_units,
        total_chunks=total_chunks,
        lane_document_counts=dict(lane_document_counts),
        lane_chunk_counts=dict(lane_chunk_counts),
        unit_type_counts=dict(unit_type_counts),
        split_reason_counts=dict(split_reason_counts),
        header_mode_counts=dict(header_mode_counts),
        notice_risk_counts=dict(inputs.notice_risk_counts),
        high_risk_notice_count=inputs.high_risk_notice_count,
        read_failures=tuple(read_failures),
        chunk_failures=tuple(chunk_failures),
        missing_manifest_records=inputs.missing_manifest_records,
        empty_document_ids=tuple(sorted(empty_document_ids)),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_lane_metadata_count=missing_lane_metadata_count,
        missing_attachment_lineage_count=missing_attachment_lineage_count,
        attachment_without_body_count=attachment_without_body_count,
        notice_body_fragmentation_count=notice_body_fragmentation_count,
        notice_body_token_guardrail_chunk_count=notice_body_token_guardrail_chunk_count,
        markup_leak_chunk_count=markup_leak_chunk_count,
        replacement_character_chunk_count=replacement_character_chunk_count,
        header_dominant_ocr_chunk_count=header_dominant_ocr_chunk_count,
        noisy_ocr_chunk_count=noisy_ocr_chunk_count,
    )


def export_internal_notice_chunk_samples(
    *,
    output_dir: Path,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: InternalNoticeChunkValidationArtifactReader | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    preparation_run_id: str | None = None,
    closeout_run_id: str | None = None,
    closeout_store: CloseoutStore | None = None,
    report: InternalNoticeChunkingValidationReport | None = None,
    scan_result: InternalNoticeChunkingScanResult | None = None,
    sample_seed: int = DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
) -> Path:
    runtime_scan = scan_result or scan_internal_notice_chunking(
        env=env,
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=source_truth_inventory_store,
        preparation_run_id=preparation_run_id,
        closeout_run_id=closeout_run_id,
        closeout_store=closeout_store,
        mode="full",
        sample_seed=sample_seed,
    )
    runtime_report = report
    if runtime_scan.mode == "full" and runtime_report is None:
        runtime_report = build_internal_notice_chunking_validation_report(scan_result=runtime_scan)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    sample_candidates = (
        [
            _InternalNoticeChunkSampleCandidate(
                bucket_name="samples",
                bucket_reason="explicit sample scan",
                document=document,
            )
            for document in runtime_scan.documents
        ]
        if runtime_scan.mode == "samples"
        else _pick_sample_candidates(documents=runtime_scan.documents, sample_seed=sample_seed)
    )
    sample_files: list[str] = []
    for index, candidate in enumerate(sample_candidates, start=1):
        filename = f"{index:02d}-{candidate.bucket_name}-{_safe_filename(candidate.document.record.document_id)}.md"
        (output_path / filename).write_text(_render_sample(candidate=candidate), encoding="utf-8")
        sample_files.append(filename)
    (output_path / "samples.json").write_text(
        json.dumps(
            {
                "mode": runtime_scan.mode,
                "selection_mode": runtime_scan.inputs.selection_mode,
                "preparation_run_id": runtime_scan.inputs.preparation_run_id,
                "closeout_run_id": runtime_scan.inputs.closeout_run_id,
                "scanned_document_count": len(runtime_scan.documents),
                "sample_files": sample_files,
                "report": asdict(runtime_report) if runtime_report is not None else None,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return output_path


def _build_validation_inputs(
    *,
    env: dict[str, str] | None,
    registry: DocumentRegistry | None,
    object_store: InternalNoticeChunkValidationArtifactReader | None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None,
    preparation_run_id: str | None,
    closeout_run_id: str | None,
    closeout_store: CloseoutStore | None,
) -> InternalNoticeValidationInputs:
    source = dict(env if env is not None else os.environ)
    corpus, collection = INTERNAL_NOTICE_SCOPE
    if preparation_run_id and closeout_run_id:
        raise ValueError("preparation_run_id and closeout_run_id are mutually exclusive")
    runtime_registry = registry
    bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(
        ObjectStoreSettings.from_env(
            {
                **source,
                "OBJECT_STORE_BUCKET_SOURCE": bucket_source,
                "OBJECT_STORE_BUCKET_DERIVED": bucket_derived,
            }
        )
    )
    if preparation_run_id:
        selected_records, missing_manifest_records, manifest_closeout_run_id = _select_manifest_records(
            source=source,
            registry=runtime_registry,
            object_store=runtime_object_store,
            bucket=bucket_derived,
            corpus=corpus,
            collection=collection,
            preparation_run_id=preparation_run_id,
            closeout_store=closeout_store,
        )
        records = selected_records
        selection_mode: Literal["current_scope", "preparation_manifest", "verified_closeout_run"] = (
            "preparation_manifest"
        )
        resolved_closeout_run_id = manifest_closeout_run_id
    elif closeout_run_id:
        runtime_closeout_store = closeout_store or build_authenticated_notice_closeout_store_from_env(source)
        selected_records = tuple(
            pair.staged_record
            for pair in load_verified_closeout_run_document_record_pairs(
                run_id=closeout_run_id,
                closeout_store=runtime_closeout_store,
                expected_corpus=corpus,
                expected_collection=collection,
            )
        )
        records = selected_records
        missing_manifest_records = ()
        selection_mode = "verified_closeout_run"
        resolved_closeout_run_id = closeout_run_id
    else:
        runtime_registry = runtime_registry or build_document_registry_from_env(source)
        records = tuple(runtime_registry.list_by_scope(corpus, collection))
        selected_records = _select_current_source_faithful_records(records)
        missing_manifest_records = ()
        selection_mode = "current_scope"
        resolved_closeout_run_id = None
    notice_risk_profiles, notice_risk_counts, high_risk_notice_count = _resolve_notice_risk_context(
        source=source,
        object_store=runtime_object_store,
        derived_bucket=bucket_derived,
        corpus=corpus,
        collection=collection,
        selected_records=selected_records,
        source_truth_inventory_store=source_truth_inventory_store,
        closeout_run_id=resolved_closeout_run_id,
        closeout_store=closeout_store,
    )
    return InternalNoticeValidationInputs(
        source=source,
        registry=runtime_registry,
        object_store=runtime_object_store,
        derived_bucket=bucket_derived,
        corpus=corpus,
        collection=collection,
        records=records,
        selected_records=selected_records,
        selection_mode=selection_mode,
        preparation_run_id=preparation_run_id,
        closeout_run_id=resolved_closeout_run_id,
        missing_manifest_records=missing_manifest_records,
        notice_risk_profiles=notice_risk_profiles,
        notice_risk_counts=notice_risk_counts,
        high_risk_notice_count=high_risk_notice_count,
    )


def _select_manifest_records(
    *,
    source: dict[str, str],
    registry: DocumentRegistry | None,
    object_store: InternalNoticeChunkValidationArtifactReader,
    bucket: str,
    corpus: str,
    collection: str,
    preparation_run_id: str,
    closeout_store: CloseoutStore | None,
) -> tuple[tuple[DocumentRegistryRecord, ...], tuple[str, ...], str | None]:
    manifest = load_chunk_preparation_manifest(
        reader=object_store,
        bucket=bucket,
        corpus=corpus,
        collection=collection,
        preparation_run_id=preparation_run_id,
    )
    if manifest.selection_mode == "verified_closeout_run":
        if not manifest.closeout_run_id:
            raise ValueError(
                "closeout-backed preparation manifest is missing closeout_run_id: "
                f"{preparation_run_id}"
            )
        runtime_closeout_store = closeout_store or build_authenticated_notice_closeout_store_from_env(source)
        pairs = load_verified_closeout_run_document_record_pairs(
            run_id=manifest.closeout_run_id,
            closeout_store=runtime_closeout_store,
            expected_corpus=corpus,
            expected_collection=collection,
        )
        pairs_by_key = {_record_key(pair.final_record): pair for pair in pairs}
        selected_records: list[DocumentRegistryRecord] = []
        missing_manifest_records: list[str] = []
        for document in manifest.documents:
            pair = pairs_by_key.get(
                (document.document_id, document.revision_track, document.version_id)
            )
            if pair is None:
                missing_manifest_records.append(
                    f"{document.document_id}::{document.revision_track}::{document.version_id}"
                )
                continue
            selected_records.append(pair.staged_record)
        return (
            tuple(selected_records),
            tuple(sorted(missing_manifest_records)),
            manifest.closeout_run_id,
        )
    selected_records: list[DocumentRegistryRecord] = []
    missing_manifest_records: list[str] = []
    runtime_registry = registry or build_document_registry_from_env(source)
    for document in manifest.documents:
        record = runtime_registry.get(document.document_id, document.revision_track, document.version_id)
        if record is None:
            missing_manifest_records.append(
                f"{document.document_id}::{document.revision_track}::{document.version_id}"
            )
            continue
        selected_records.append(record)
    return tuple(selected_records), tuple(sorted(missing_manifest_records)), manifest.closeout_run_id


def _select_current_source_faithful_records(
    records: Sequence[DocumentRegistryRecord],
) -> tuple[DocumentRegistryRecord, ...]:
    grouped: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        grouped.setdefault(record.document_id, []).append(record)
    selected_records: list[DocumentRegistryRecord] = []
    for document_id in sorted(grouped):
        doc_records = grouped[document_id]
        preferred = [record for record in doc_records if record.is_current and record.revision_track == "source-faithful"]
        if preferred:
            selected_records.append(max(preferred, key=lambda record: record.ingestion_timestamp))
            continue
        source_faithful = [record for record in doc_records if record.revision_track == "source-faithful"]
        if source_faithful:
            selected_records.append(max(source_faithful, key=lambda record: record.ingestion_timestamp))
    return tuple(selected_records)


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str, str]:
    return (record.document_id, record.revision_track, record.version_id)


def _scan_all_documents(
    *,
    inputs: InternalNoticeValidationInputs,
) -> tuple[InternalNoticeScannedDocument, ...]:
    if not inputs.selected_records:
        return ()
    max_workers = max(1, min(_resolve_max_workers(inputs.source), len(inputs.selected_records)))
    if max_workers == 1:
        return tuple(_scan_record(record=record, inputs=inputs) for record in inputs.selected_records)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return tuple(executor.map(lambda record: _scan_record(record=record, inputs=inputs), inputs.selected_records))


def _scan_record(
    *,
    record: DocumentRegistryRecord,
    inputs: InternalNoticeValidationInputs,
) -> InternalNoticeScannedDocument:
    title = record.document_id
    lane = _NOTICE_BODY_LANE if not record.document_id.startswith("notice_attachment:") else _ATTACHMENT_TEXT_LANE
    notice_id = _resolve_notice_id_from_document_id(record.document_id)
    notice_risk_profile = inputs.notice_risk_profiles.get(notice_id)
    try:
        structured_jsonl_bytes = inputs.object_store.get_bytes(
            bucket=inputs.derived_bucket,
            key=_require_document_units_key(record),
        )
        rows = tuple(_load_rows(structured_jsonl_bytes))
        title = _derive_document_title(rows) or title
        lane = _resolve_document_lane(record=record, rows=rows)
    except Exception as exc:
        return InternalNoticeScannedDocument(
            title=title,
            lane=lane,
            notice_id=notice_id,
            notice_risk_profile=notice_risk_profile,
            record=record,
            rows=(),
            chunks=(),
            read_failure=InternalNoticeChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    try:
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_jsonl_bytes,
        )
    except Exception as exc:
        return InternalNoticeScannedDocument(
            title=title,
            lane=lane,
            notice_id=notice_id,
            notice_risk_profile=notice_risk_profile,
            record=record,
            rows=rows,
            chunks=(),
            chunk_failure=InternalNoticeChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    return InternalNoticeScannedDocument(
        title=title,
        lane=lane,
        notice_id=notice_id,
        notice_risk_profile=notice_risk_profile,
        record=record,
        rows=rows,
        chunks=chunks,
    )


def _pick_sample_documents(
    *,
    documents: Sequence[InternalNoticeScannedDocument],
    sample_seed: int,
) -> tuple[InternalNoticeScannedDocument, ...]:
    return tuple(candidate.document for candidate in _pick_sample_candidates(documents=documents, sample_seed=sample_seed))


def _pick_sample_candidates(
    *,
    documents: Sequence[InternalNoticeScannedDocument],
    sample_seed: int,
) -> list[_InternalNoticeChunkSampleCandidate]:
    rng = random.Random(sample_seed)
    chosen_ids: set[str] = set()
    picked: list[_InternalNoticeChunkSampleCandidate] = []

    def pick(*, bucket_name: str, bucket_reason: str, predicate) -> None:
        eligible = [document for document in documents if predicate(document) and document.record.document_id not in chosen_ids]
        if not eligible:
            return
        document = rng.choice(eligible)
        chosen_ids.add(document.record.document_id)
        picked.append(
            _InternalNoticeChunkSampleCandidate(
                bucket_name=bucket_name,
                bucket_reason=bucket_reason,
                document=document,
            )
        )

    pick(
        bucket_name="notice-risk-spatial",
        bucket_reason="notice carrying spatial/manual-review attachments",
        predicate=lambda document: document.read_failure is None
        and document.chunk_failure is None
        and _notice_risk_label(document) == NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
    )
    pick(
        bucket_name="notice-risk-mixed-high-risk",
        bucket_reason="notice mixing spatial and text/reference attachment lanes",
        predicate=lambda document: document.read_failure is None
        and document.chunk_failure is None
        and _notice_risk_label(document) == NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    )
    pick(
        bucket_name="notice-body",
        bucket_reason="normal parent notice body sample",
        predicate=lambda document: document.read_failure is None and document.chunk_failure is None and document.lane == _NOTICE_BODY_LANE,
    )
    pick(
        bucket_name="attachment-text",
        bucket_reason="normal text-extractable attachment sample",
        predicate=lambda document: document.read_failure is None
        and document.chunk_failure is None
        and document.lane == _ATTACHMENT_TEXT_LANE,
    )
    pick(
        bucket_name="attachment-ocr",
        bucket_reason="normal OCR attachment sample",
        predicate=lambda document: document.read_failure is None
        and document.chunk_failure is None
        and document.lane == _ATTACHMENT_OCR_LANE,
    )
    pick(
        bucket_name="notice-body-fragmentation",
        bucket_reason="notice body fragmentation suspect sample",
        predicate=lambda document: any(
            _is_fragmented_notice_body_chunk(chunk=chunk, document_chunk_count=len(document.chunks))
            for chunk in document.chunks
            if _chunk_unit_type(chunk) == "article_body"
        ),
    )
    pick(
        bucket_name="ocr-noise-suspect",
        bucket_reason="OCR noise suspect sample",
        predicate=lambda document: document.lane == _ATTACHMENT_OCR_LANE and any(
            _is_header_dominant_ocr_chunk(chunk) or _looks_like_noisy_ocr_chunk(_resolve_display_text(chunk))
            for chunk in document.chunks
            if _chunk_unit_type(chunk) in _ATTACHMENT_OCR_NOISE_UNIT_TYPES
        ),
    )
    pick(
        bucket_name="html-leak-or-markup-leak",
        bucket_reason="cleanup failure sample",
        predicate=lambda document: any(
            _contains_markup_leak(chunk.text) or _contains_markup_leak(_resolve_display_text(chunk))
            for chunk in document.chunks
            if _chunk_unit_type(chunk) in _TEXTUAL_CHUNK_UNIT_TYPES
        ),
    )
    return picked


def _render_sample(
    *,
    candidate: _InternalNoticeChunkSampleCandidate,
) -> str:
    document = candidate.document
    notice_risk_profile = document.notice_risk_profile
    row_summary = [
        {
            "chunk_id": row.get("chunk_id"),
            "unit_type": row.get("unit_type"),
            "anchor": row.get("anchor"),
            "metadata": row.get("metadata"),
            "clean_text": row.get("clean_text"),
        }
        for row in document.rows
    ]
    chunk_sections: list[str] = []
    for chunk in document.chunks:
        chunk_sections.append(
            "\n".join(
                [
                    f"### {chunk.chunk_id}",
                    f"- Unit Type: {_chunk_unit_type(chunk)}",
                    f"- Lane: {chunk.metadata.get('internal_notice_lane')}",
                    f"- Header Mode: {chunk.metadata.get('header_mode')}",
                    f"- Split Reason: {chunk.metadata.get('split_reason')}",
                    f"- Final Tokens: {chunk.metadata.get('final_token_count')}",
                    "",
                    "```text",
                    chunk.text,
                    "```",
                ]
            )
        )
    return "\n".join(
        [
            f"# {document.title}",
            "",
            f"- Bucket: {candidate.bucket_name}",
            f"- Bucket Reason: {candidate.bucket_reason}",
            f"- Lane: {document.lane}",
            f"- Notice ID: {document.notice_id}",
            f"- Notice Risk Label: {notice_risk_profile.notice_risk_label if notice_risk_profile is not None else 'unavailable'}",
            f"- Attachment Mix Score: {notice_risk_profile.attachment_mix_score if notice_risk_profile is not None else 'n/a'}",
            f"- Attachment Ref Count: {notice_risk_profile.attachment_ref_count if notice_risk_profile is not None else 'n/a'}",
            f"- Has Text/Table Attachment: {notice_risk_profile.has_text_table_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Has Spatial Attachment: {notice_risk_profile.has_spatial_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Has Reference-only Attachment: {notice_risk_profile.has_reference_only_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Document ID: {document.record.document_id}",
            f"- Source URI: {document.record.source_uri}",
            "",
            "## Source Rows",
            "```json",
            json.dumps(row_summary, ensure_ascii=False, indent=2),
            "```",
            "",
            "## Chunk Text",
            *chunk_sections,
            "",
        ]
    )


def _resolve_document_lane(
    *,
    record: DocumentRegistryRecord,
    rows: Sequence[dict[str, object]],
) -> str:
    if not record.document_id.startswith("notice_attachment:"):
        return _NOTICE_BODY_LANE
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        extraction_class = str(metadata.get("extraction_class") or "").strip()
        if extraction_class == "text_extractable":
            return _ATTACHMENT_TEXT_LANE
        if extraction_class == "ocr_required":
            return _ATTACHMENT_OCR_LANE
    raise ValueError(f"attachment extraction_class is required for {record.document_id}")


def _resolve_notice_risk_context(
    *,
    source: dict[str, str],
    object_store: InternalNoticeChunkValidationArtifactReader,
    derived_bucket: str,
    corpus: str,
    collection: str,
    selected_records: Sequence[DocumentRegistryRecord],
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None,
    closeout_run_id: str | None,
    closeout_store: CloseoutStore | None,
) -> tuple[dict[str, InternalNoticeNoticeRiskProfile], dict[str, int], int]:
    notice_ids = tuple(
        sorted(
            {
                notice_id
                for record in selected_records
                if (notice_id := _resolve_notice_id_from_document_id(record.document_id))
            }
        )
    )
    if not notice_ids:
        return {}, {}, 0
    if closeout_run_id:
        runtime_closeout_store = closeout_store or build_authenticated_notice_closeout_store_from_env(source)
        run = runtime_closeout_store.get_run(closeout_run_id)
        if run is not None and str(getattr(run, "source_truth_inventory_object_key", "") or "").strip():
            profiles = _load_notice_risk_profiles_from_closeout_run(
                run_id=closeout_run_id,
                inventory_object_key=str(run.source_truth_inventory_object_key),
                object_store=object_store,
                derived_bucket=derived_bucket,
                notice_ids=notice_ids,
            )
            if profiles:
                return _summarize_notice_risk_profiles(profiles)
    runtime_inventory_store = source_truth_inventory_store
    if runtime_inventory_store is None:
        try:
            runtime_inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(source)
        except ValueError:
            runtime_inventory_store = None
    if runtime_inventory_store is None:
        return {}, {}, 0
    entries = runtime_inventory_store.list_by_scope(corpus, collection, notice_ids=notice_ids)
    profiles = {
        entry.notice_id: InternalNoticeNoticeRiskProfile(
            notice_id=entry.notice_id,
            notice_risk_label=str(entry.notice_risk_label or NOTICE_RISK_LABEL_BODY_ONLY),
            attachment_mix_score=int(entry.attachment_mix_score or 0),
            attachment_ref_count=int(entry.attachment_ref_count or 0),
            has_text_table_attachment=bool(entry.has_text_table_attachment),
            has_spatial_attachment=bool(entry.has_spatial_attachment),
            has_reference_only_attachment=bool(entry.has_reference_only_attachment),
        )
        for entry in entries
    }
    return _summarize_notice_risk_profiles(profiles)


def _load_notice_risk_profiles_from_closeout_run(
    *,
    run_id: str,
    inventory_object_key: str,
    object_store: InternalNoticeChunkValidationArtifactReader,
    derived_bucket: str,
    notice_ids: Sequence[str],
) -> dict[str, InternalNoticeNoticeRiskProfile]:
    payload = json.loads(
        object_store.get_bytes(bucket=derived_bucket, key=inventory_object_key).decode("utf-8")
    )
    if str(payload.get("run_id") or "") != run_id:
        raise ValueError(f"closeout frozen inventory run mismatch: {run_id}")
    selected_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
    profiles: dict[str, InternalNoticeNoticeRiskProfile] = {}
    for parent in tuple(payload.get("parents") or ()):
        notice_id = str(parent.get("notice_id") or "").strip()
        if not notice_id or (selected_notice_ids and notice_id not in selected_notice_ids):
            continue
        profiles[notice_id] = InternalNoticeNoticeRiskProfile(
            notice_id=notice_id,
            notice_risk_label=str(parent.get("notice_risk_label") or NOTICE_RISK_LABEL_BODY_ONLY),
            attachment_mix_score=int(parent.get("attachment_mix_score") or 0),
            attachment_ref_count=int(parent.get("attachment_ref_count") or 0),
            has_text_table_attachment=bool(parent.get("has_text_table_attachment")),
            has_spatial_attachment=bool(parent.get("has_spatial_attachment")),
            has_reference_only_attachment=bool(parent.get("has_reference_only_attachment")),
        )
    return profiles


def _summarize_notice_risk_profiles(
    profiles: dict[str, InternalNoticeNoticeRiskProfile],
) -> tuple[dict[str, InternalNoticeNoticeRiskProfile], dict[str, int], int]:
    notice_risk_counts = _aggregate_notice_risk_counts(
        tuple(profile.notice_risk_label for profile in profiles.values())
    )
    high_risk_notice_count = sum(
        1
        for profile in profiles.values()
        if profile.notice_risk_label in HIGH_RISK_NOTICE_LABELS
    )
    return profiles, notice_risk_counts, high_risk_notice_count


def _resolve_notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[0] in {"notice", "notice_attachment"} and parts[2]:
        return parts[2]
    return str(document_id).strip()


def _notice_risk_label(document: InternalNoticeScannedDocument) -> str:
    if document.notice_risk_profile is None:
        return NOTICE_RISK_LABEL_BODY_ONLY
    return document.notice_risk_profile.notice_risk_label


def _derive_document_title(rows: Sequence[dict[str, object]]) -> str | None:
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        title = str(metadata.get("title") or "").strip()
        if title:
            return title
    for row in rows:
        if str(row.get("unit_type") or "") in {"policy_page", "attachment_title"}:
            title = str(row.get("clean_text") or row.get("text") or "").strip()
            if title:
                return title
    for row in rows:
        title = str(row.get("clean_text") or row.get("text") or "").strip()
        if title:
            return title
    return None


def _document_has_stable_title_source(rows: Sequence[dict[str, object]]) -> bool:
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        if str(metadata.get("title") or "").strip():
            return True
    for row in rows:
        if str(row.get("unit_type") or "") in {"policy_page", "attachment_title"}:
            title = str(row.get("clean_text") or row.get("text") or "").strip()
            if title:
                return True
    return False


def _load_rows(structured_jsonl_bytes: bytes) -> list[dict[str, object]]:
    return [json.loads(line) for line in structured_jsonl_bytes.decode("utf-8").splitlines() if line.strip()]


def _resolve_max_workers(source: dict[str, str]) -> int:
    value = str(source.get("INTERNAL_NOTICE_CHUNK_VALIDATION_MAX_WORKERS") or "8").strip()
    try:
        return max(1, int(value))
    except ValueError:
        return 8


def _require_document_units_key(record: DocumentRegistryRecord) -> str:
    if not record.document_units_object_key:
        raise ValueError("document_units_object_key is required")
    return record.document_units_object_key


def _chunk_unit_type(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("unit_type") or "unknown")


def _resolve_chunk_title(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("title") or "").strip()


def _resolve_display_text(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("display_text") or chunk.text or "")


def _has_attachment_lineage(chunk: IndexableChunk) -> bool:
    return all(str(chunk.metadata.get(field_name) or "").strip() for field_name in _ATTACHMENT_LINEAGE_FIELDS)


def _contains_markup_leak(text: str) -> bool:
    return bool(_MARKUP_LEAK_RE.search(text))


def _is_fragmented_notice_body_chunk(
    *,
    chunk: IndexableChunk,
    document_chunk_count: int,
) -> bool:
    if document_chunk_count <= 1 or _chunk_unit_type(chunk) != "article_body":
        return False
    final_token_count = int(chunk.metadata.get("final_token_count") or 0)
    if final_token_count >= _NOTICE_BODY_FRAGMENT_FINAL_TOKEN_THRESHOLD:
        return False
    return bool(str(chunk.metadata.get("split_reason") or "").strip())


def _is_header_dominant_ocr_chunk(chunk: IndexableChunk) -> bool:
    final_token_count = int(chunk.metadata.get("final_token_count") or 0)
    display_token_count = int(chunk.metadata.get("display_token_count") or 0)
    header_token_count = int(chunk.metadata.get("header_token_count") or 0)
    if final_token_count <= 0 or display_token_count <= 0:
        return False
    if display_token_count >= _OCR_HEADER_DOMINANT_DISPLAY_TOKEN_THRESHOLD:
        return False
    return (header_token_count / final_token_count) > _OCR_HEADER_DOMINANT_RATIO_THRESHOLD


def _looks_like_noisy_ocr_chunk(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    non_space_matches = _NON_SPACE_RE.findall(normalized)
    if not non_space_matches:
        return False
    useful_char_ratio = len(_USEFUL_CHAR_RE.findall(normalized)) / len(non_space_matches)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    short_line_ratio = 0.0
    if lines:
        short_line_ratio = sum(1 for line in lines if len(line) <= 3) / len(lines)
    if useful_char_ratio < _OCR_USEFUL_CHAR_RATIO_THRESHOLD and short_line_ratio > _OCR_SHORT_LINE_RATIO_THRESHOLD:
        return True
    return useful_char_ratio < 0.35


def _safe_filename(value: str) -> str:
    normalized = _SAFE_FILENAME_RE.sub("-", value.lower()).strip("-")
    return normalized or "sample"


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED",
    "InternalNoticeChunkValidationFailure",
    "InternalNoticeChunkingScanResult",
    "InternalNoticeChunkingValidationReport",
    "InternalNoticeScannedDocument",
    "InternalNoticeValidationInputs",
    "build_internal_notice_chunking_validation_report",
    "export_internal_notice_chunk_samples",
    "scan_internal_notice_chunking",
    "validate_internal_notice_chunking",
]
