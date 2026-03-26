from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import socket
from typing import Literal, Protocol, Sequence
from urllib.parse import urlparse

from campus_ingestion_core.chunking import (
    ChunkProfile,
    StructuredUnitChunkInput,
    TABLE_UNIT_TYPES,
    build_student_handbook_chunk_profile,
    clean_structured_text,
    estimate_token_count,
    resolve_display_budget,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.handbook_cleanup import (
    ARTICLE_PREFIX_RE,
    SHORT_HEADING_BODY_STARTERS,
    SHORT_HEADING_WHITELIST,
    _find_boundary_overlap,
    _has_unclosed_citation_context,
    _looks_like_appendix_leaf_section_heading,
    _looks_like_title_like_heading_remainder,
    _split_short_heading_from_body,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import DEFAULT_BUCKET_PROCESSED, ObjectStoreSettings
from campus_ingestion_core.split_manifest import load_split_manifest
from campus_ingestion_core.tokenizer_cache import resolve_prefetched_hf_tokenizer_path


DEFAULT_HANDBOOK_MANIFEST_PATH = Path("configs/ingestion/regulations/student_handbook/split-manifest.v1.json")
HANDBOOK_SCOPE = ("regulations", "student_handbook")
PARENT_UNIT_TYPES = {"article_body", "policy_page"}
SAMPLE_BUCKETS = (
    ("structure-boundary", "触发结构优先拆分"),
    ("token-guardrail", "触发 token_guardrail"),
    ("table", "包含表格与表格行"),
    ("policy-page", "以 policy_page 为主"),
    ("plain-article", "普通 article_body"),
)
TINY_TEXTUAL_FINAL_TOKEN_THRESHOLD = 80
HEADER_DOMINANT_RATIO_THRESHOLD = 0.4
VERBOSE_HEADER_MODES = {"full_path", "compact_path", "required"}
VALIDATION_LIST_MARKER_RE = re.compile(
    r"^(?P<label>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))\s*(?P<body>.+)$"
)


class ChunkValidationArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def healthcheck(self, *, bucket: str) -> None: ...


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
    header_only_table_chunk_count: int
    generic_table_label_chunk_count: int
    polluted_section_path_count: int
    missing_contextualization_count: int
    broken_citation_linebreak_count: int
    unclosed_citation_context_count: int
    heading_body_glue_count: int
    adjacent_overlap_duplication_count: int
    tiny_textual_chunk_count: int
    header_dominant_chunk_count: int
    small_unaggregated_chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    boundary_rule_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    oversize_parent_unit_counts: dict[str, int]
    oversize_multiline_parent_unit_counts: dict[str, int]
    structure_eligible_unit_counts: dict[str, int]
    chunk_token_histogram: dict[str, int]
    header_token_histogram: dict[str, int]
    display_token_histogram: dict[str, int]


@dataclass(frozen=True, slots=True)
class StudentHandbookValidationInputs:
    source: dict[str, str]
    chunk_profile: ChunkProfile
    registry: DocumentRegistry
    object_store: ChunkValidationArtifactReader
    processed_bucket: str
    manifest_path: Path
    manifest_titles: dict[str, str]
    records: tuple[DocumentRegistryRecord, ...]
    records_by_doc: dict[str, tuple[DocumentRegistryRecord, ...]]
    selected_records: tuple[DocumentRegistryRecord, ...]
    extra_registry_document_ids: tuple[str, ...]
    missing_registry_document_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkSampleCandidate:
    title: str
    document_id: str
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[object, ...]
    split_reasons: dict[str, int]
    unit_types: dict[str, int]
    boundary_rules: dict[str, int]


@dataclass(frozen=True, slots=True)
class StudentHandbookScannedDocument:
    title: str
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[object, ...]
    read_failure: ChunkValidationFailure | None = None
    chunk_failure: ChunkValidationFailure | None = None


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkingScanResult:
    mode: Literal["full", "samples"]
    inputs: StudentHandbookValidationInputs
    documents: tuple[StudentHandbookScannedDocument, ...]


def scan_student_handbook_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
    mode: Literal["full", "samples"] = "full",
    sample_seed: int = 20260325,
) -> StudentHandbookChunkingScanResult:
    inputs = _build_validation_inputs(
        env=env,
        registry=registry,
        object_store=object_store,
        manifest_path=manifest_path,
        chunk_profile=chunk_profile,
    )
    _ensure_validation_runtime_ready(inputs)
    cache_dir = _resolve_validation_cache_dir(inputs.source)
    documents: tuple[StudentHandbookScannedDocument, ...]
    if mode == "samples":
        documents = _scan_sample_candidates_only(
            inputs=inputs,
            cache_dir=cache_dir,
            sample_seed=sample_seed,
        )
    else:
        documents = _scan_all_documents(
            inputs=inputs,
            cache_dir=cache_dir,
        )
    return StudentHandbookChunkingScanResult(
        mode=mode,
        inputs=inputs,
        documents=documents,
    )


def validate_student_handbook_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
    scan_result: StudentHandbookChunkingScanResult | None = None,
) -> StudentHandbookChunkingValidationReport:
    runtime_scan = scan_result or scan_student_handbook_chunking(
        env=env,
        registry=registry,
        object_store=object_store,
        manifest_path=manifest_path,
        chunk_profile=chunk_profile,
        mode="full",
    )
    return build_student_handbook_chunking_validation_report(scan_result=runtime_scan)


def build_student_handbook_chunking_validation_report(
    *,
    scan_result: StudentHandbookChunkingScanResult,
) -> StudentHandbookChunkingValidationReport:
    if scan_result.mode != "full":
        raise ValueError("validation report requires a full handbook chunk scan")
    inputs = scan_result.inputs
    runtime_profile = inputs.chunk_profile
    read_failures: list[ChunkValidationFailure] = []
    chunk_failures: list[ChunkValidationFailure] = []
    empty_document_ids: list[str] = []
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    boundary_rule_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    oversize_parent_unit_counts: Counter[str] = Counter()
    oversize_multiline_parent_unit_counts: Counter[str] = Counter()
    structure_eligible_unit_counts: Counter[str] = Counter()
    chunk_counts_per_doc: list[int] = []
    total_units = 0
    non_table_oversize_chunk_count = 0
    header_only_table_chunk_count = 0
    generic_table_label_chunk_count = 0
    polluted_section_path_count = 0
    missing_contextualization_count = 0
    broken_citation_linebreak_count = 0
    unclosed_citation_context_count = 0
    heading_body_glue_count = 0
    adjacent_overlap_duplication_count = 0
    tiny_textual_chunk_count = 0
    header_dominant_chunk_count = 0
    small_unaggregated_chunk_count = 0
    chunk_token_histogram: Counter[str] = Counter()
    header_token_histogram: Counter[str] = Counter()
    display_token_histogram: Counter[str] = Counter()

    for document in scan_result.documents:
        title = document.title
        record = document.record
        if document.read_failure is not None:
            read_failures.append(document.read_failure)
            continue
        if document.chunk_failure is not None:
            chunk_failures.append(document.chunk_failure)
            continue
        rows = list(document.rows)
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
        chunks = document.chunks
        if not chunks:
            empty_document_ids.append(record.document_id)
        chunk_counts_per_doc.append(len(chunks))
        for chunk_index, chunk in enumerate(chunks):
            split_reason_counts[str(chunk.metadata.get("split_reason") or "none")] += 1
            boundary_rule_counts[str(chunk.metadata.get("boundary_rule") or "none")] += 1
            header_mode_counts[str(chunk.metadata.get("header_mode") or "none")] += 1
            if _chunk_requires_context(chunk) and not bool(chunk.metadata.get("contextualized_text")):
                missing_contextualization_count += 1
            if _has_broken_citation_linebreak(chunk):
                broken_citation_linebreak_count += 1
            if _is_textual_chunk(chunk) and _has_unclosed_citation_context_in_chunk(chunk):
                unclosed_citation_context_count += 1
            if _has_heading_body_glue(chunk):
                heading_body_glue_count += 1
            if _has_adjacent_overlap_duplication(chunk):
                adjacent_overlap_duplication_count += 1
            if _is_header_only_table_chunk(chunk):
                header_only_table_chunk_count += 1
            if _has_generic_table_label(chunk):
                generic_table_label_chunk_count += 1
            token_count = estimate_token_count(chunk.text, chunk_profile=runtime_profile)
            chunk_token_histogram[_histogram_bucket(token_count)] += 1
            header_token_histogram[_histogram_bucket(int(chunk.metadata.get("header_token_count") or 0))] += 1
            display_token_histogram[_histogram_bucket(int(chunk.metadata.get("display_token_count") or 0))] += 1
            if str(chunk.metadata.get("unit_type") or "") not in TABLE_UNIT_TYPES and token_count > runtime_profile.max_chunk_size:
                non_table_oversize_chunk_count += 1
            if _is_textual_chunk(chunk):
                final_token_count = int(chunk.metadata.get("final_token_count") or token_count)
                header_token_count = int(chunk.metadata.get("header_token_count") or 0)
                if final_token_count < TINY_TEXTUAL_FINAL_TOKEN_THRESHOLD:
                    tiny_textual_chunk_count += 1
                    if (
                        not chunk.metadata.get("aggregation_mode")
                        and _has_actionable_short_textual_merge_neighbor(
                            chunks=chunks,
                            chunk_index=chunk_index,
                            chunk_profile=runtime_profile,
                        )
                    ):
                        small_unaggregated_chunk_count += 1
                if _is_verbose_header_dominant_chunk(
                    chunk=chunk,
                    header_token_count=header_token_count,
                    final_token_count=final_token_count,
                ):
                    header_dominant_chunk_count += 1

    total_chunks = sum(chunk_counts_per_doc)
    validated_document_count = len(chunk_counts_per_doc)
    passed = not (
        inputs.extra_registry_document_ids
        or inputs.missing_registry_document_ids
        or read_failures
        or chunk_failures
        or empty_document_ids
        or non_table_oversize_chunk_count
        or header_only_table_chunk_count
        or generic_table_label_chunk_count
        or polluted_section_path_count
        or missing_contextualization_count
        or broken_citation_linebreak_count
        or unclosed_citation_context_count
        or heading_body_glue_count
        or adjacent_overlap_duplication_count
        or header_dominant_chunk_count
        or small_unaggregated_chunk_count
    )
    return StudentHandbookChunkingValidationReport(
        passed=passed,
        chunk_policy_version=runtime_profile.chunk_policy_version,
        tokenizer_name=runtime_profile.tokenizer_name,
        manifest_document_count=len(inputs.manifest_titles),
        registry_record_count=len(inputs.records),
        registry_unique_document_count=len(inputs.records_by_doc),
        selected_source_faithful_record_count=len(inputs.selected_records),
        validated_document_count=validated_document_count,
        total_units=total_units,
        total_chunks=total_chunks,
        avg_units_per_document=round(total_units / validated_document_count, 2) if validated_document_count else 0.0,
        avg_chunks_per_document=round(total_chunks / validated_document_count, 2)
        if validated_document_count
        else 0.0,
        max_chunks_in_document=max(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        min_chunks_in_document=min(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        extra_registry_document_ids=inputs.extra_registry_document_ids,
        missing_registry_document_ids=inputs.missing_registry_document_ids,
        read_failures=tuple(read_failures),
        chunk_failures=tuple(chunk_failures),
        empty_document_ids=tuple(sorted(empty_document_ids)),
        non_table_oversize_chunk_count=non_table_oversize_chunk_count,
        header_only_table_chunk_count=header_only_table_chunk_count,
        generic_table_label_chunk_count=generic_table_label_chunk_count,
        polluted_section_path_count=polluted_section_path_count,
        missing_contextualization_count=missing_contextualization_count,
        broken_citation_linebreak_count=broken_citation_linebreak_count,
        unclosed_citation_context_count=unclosed_citation_context_count,
        heading_body_glue_count=heading_body_glue_count,
        adjacent_overlap_duplication_count=adjacent_overlap_duplication_count,
        tiny_textual_chunk_count=tiny_textual_chunk_count,
        header_dominant_chunk_count=header_dominant_chunk_count,
        small_unaggregated_chunk_count=small_unaggregated_chunk_count,
        unit_type_counts=dict(unit_type_counts),
        split_reason_counts=dict(split_reason_counts),
        boundary_rule_counts=dict(boundary_rule_counts),
        header_mode_counts=dict(header_mode_counts),
        oversize_parent_unit_counts=dict(oversize_parent_unit_counts),
        oversize_multiline_parent_unit_counts=dict(oversize_multiline_parent_unit_counts),
        structure_eligible_unit_counts=dict(structure_eligible_unit_counts),
        chunk_token_histogram=dict(chunk_token_histogram),
        header_token_histogram=dict(header_token_histogram),
        display_token_histogram=dict(display_token_histogram),
    )


def export_student_handbook_chunk_samples(
    *,
    output_dir: Path,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
    report: StudentHandbookChunkingValidationReport | None = None,
    scan_result: StudentHandbookChunkingScanResult | None = None,
    sample_seed: int = 20260325,
) -> Path:
    runtime_scan = scan_result or scan_student_handbook_chunking(
        env=env,
        registry=registry,
        object_store=object_store,
        manifest_path=manifest_path,
        chunk_profile=chunk_profile,
        mode="full",
        sample_seed=sample_seed,
    )
    inputs = runtime_scan.inputs
    runtime_profile = inputs.chunk_profile
    runtime_report = report
    if runtime_report is None and runtime_scan.mode == "full":
        runtime_report = build_student_handbook_chunking_validation_report(scan_result=runtime_scan)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    (output_path / "validation-report.json").write_text(
        json.dumps(
            asdict(runtime_report)
            if runtime_report is not None
            else {
                "mode": runtime_scan.mode,
                "scanned_document_count": len(runtime_scan.documents),
                "chunk_profile_version": runtime_profile.chunk_policy_version,
                "tokenizer_name": runtime_profile.tokenizer_name,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    candidates: list[StudentHandbookChunkSampleCandidate] = []
    header_tokens: list[int] = []
    display_tokens: list[int] = []
    final_tokens: list[int] = []
    oversize_chunks: list[dict[str, object]] = []

    for document in runtime_scan.documents:
        if document.read_failure is not None or document.chunk_failure is not None:
            continue
        record = document.record
        title = document.title
        rows = document.rows
        chunks = document.chunks
        if not chunks:
            continue
        split_reasons = Counter(str(chunk.metadata.get("split_reason") or "none") for chunk in chunks)
        unit_types = Counter(str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks)
        boundary_rules = Counter(str(chunk.metadata.get("boundary_rule") or "none") for chunk in chunks)
        for chunk in chunks:
            header_tokens.append(int(chunk.metadata.get("header_token_count") or 0))
            display_tokens.append(int(chunk.metadata.get("display_token_count") or 0))
            final_tokens.append(int(chunk.metadata.get("final_token_count") or 0))
            if (
                str(chunk.metadata.get("unit_type") or "") not in TABLE_UNIT_TYPES
                and int(chunk.metadata.get("final_token_count") or 0) > runtime_profile.max_chunk_size
            ):
                oversize_chunks.append(
                    {
                        "document_id": record.document_id,
                        "title": title,
                        "chunk_id": chunk.chunk_id,
                        "tokens": int(chunk.metadata.get("final_token_count") or 0),
                        "split_reason": chunk.metadata.get("split_reason"),
                        "boundary_rule": chunk.metadata.get("boundary_rule"),
                    }
                )
        candidates.append(
            StudentHandbookChunkSampleCandidate(
                title=title,
                document_id=record.document_id,
                record=record,
                rows=rows,
                chunks=chunks,
                split_reasons=dict(split_reasons),
                unit_types=dict(unit_types),
                boundary_rules=dict(boundary_rules),
            )
        )

    (output_path / "oversize-chunks.json").write_text(
        json.dumps(oversize_chunks, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_path / "header-budget-summary.json").write_text(
        json.dumps(
            {
                "chunk_count": len(final_tokens),
                "chunk_policy_version": runtime_profile.chunk_policy_version,
                "tokenizer_name": runtime_profile.tokenizer_name,
                "chunk_size": runtime_profile.chunk_size,
                "max_chunk_size": runtime_profile.max_chunk_size,
                "chunk_overlap": runtime_profile.chunk_overlap,
                "min_chunk_size": runtime_profile.min_chunk_size,
                "safety_margin": runtime_profile.safety_margin,
                "header_tokens": _summarize_tokens(header_tokens),
                "display_tokens": _summarize_tokens(display_tokens),
                "final_tokens": _summarize_tokens(final_tokens),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    picked = _pick_sample_candidates(candidates, sample_seed=sample_seed)
    index_lines = [
        "# Chunk Resample Batch",
        "",
        f"- chunk_profile_version: `{runtime_report.chunk_policy_version if runtime_report is not None else runtime_profile.chunk_policy_version}`",
        f"- tokenizer_name: `{runtime_report.tokenizer_name if runtime_report is not None else runtime_profile.tokenizer_name}`",
        f"- validation_passed: `{runtime_report.passed if runtime_report is not None else 'n/a'}`",
        f"- total_units: `{runtime_report.total_units if runtime_report is not None else 'n/a'}`",
        f"- total_chunks: `{runtime_report.total_chunks if runtime_report is not None else 'n/a'}`",
        f"- non_table_oversize_chunk_count: `{runtime_report.non_table_oversize_chunk_count if runtime_report is not None else 'n/a'}`",
        f"- header_only_table_chunk_count: `{runtime_report.header_only_table_chunk_count if runtime_report is not None else 'n/a'}`",
        f"- generic_table_label_chunk_count: `{runtime_report.generic_table_label_chunk_count if runtime_report is not None else 'n/a'}`",
        f"- polluted_section_path_count: `{runtime_report.polluted_section_path_count if runtime_report is not None else 'n/a'}`",
        f"- missing_contextualization_count: `{runtime_report.missing_contextualization_count if runtime_report is not None else 'n/a'}`",
        f"- broken_citation_linebreak_count: `{runtime_report.broken_citation_linebreak_count if runtime_report is not None else 'n/a'}`",
        f"- unclosed_citation_context_count: `{runtime_report.unclosed_citation_context_count if runtime_report is not None else 'n/a'}`",
        f"- heading_body_glue_count: `{runtime_report.heading_body_glue_count if runtime_report is not None else 'n/a'}`",
        f"- adjacent_overlap_duplication_count: `{runtime_report.adjacent_overlap_duplication_count if runtime_report is not None else 'n/a'}`",
        f"- tiny_textual_chunk_count: `{runtime_report.tiny_textual_chunk_count if runtime_report is not None else 'n/a'}`",
        f"- header_dominant_chunk_count: `{runtime_report.header_dominant_chunk_count if runtime_report is not None else 'n/a'}`",
        f"- small_unaggregated_chunk_count: `{runtime_report.small_unaggregated_chunk_count if runtime_report is not None else 'n/a'}`",
        "",
        "## Files",
        "",
        "- [validation-report.json](./validation-report.json)",
        "- [header-budget-summary.json](./header-budget-summary.json)",
        "- [oversize-chunks.json](./oversize-chunks.json)",
    ]
    for index, (bucket_name, bucket_reason, candidate) in enumerate(picked, start=1):
        filename = f"{index:02d}-{bucket_name}.md"
        (output_path / filename).write_text(
            _render_sample(
                title=candidate.title,
                bucket_name=bucket_name,
                bucket_reason=bucket_reason,
                record=candidate.record,
                rows=candidate.rows,
                chunks=candidate.chunks,
            ),
            encoding="utf-8",
        )
        index_lines.append(f"- [{filename}](./{filename}) : {candidate.title} ({bucket_reason})")
    (output_path / "INDEX.md").write_text("\n".join(index_lines).rstrip() + "\n", encoding="utf-8")
    return output_path


def _ensure_validation_runtime_ready(inputs: StudentHandbookValidationInputs) -> None:
    _ensure_object_store_is_reachable(inputs)
    _ensure_prefetched_tokenizer_is_available(inputs.chunk_profile.tokenizer_name)


def _ensure_object_store_is_reachable(inputs: StudentHandbookValidationInputs) -> None:
    source = inputs.source
    endpoint = (source.get("OBJECT_STORE_ENDPOINT") or "").strip()
    if endpoint:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if host:
            try:
                with socket.create_connection((host, port), timeout=1.0):
                    pass
            except OSError as exc:
                raise RuntimeError(
                    f"Object store endpoint is unreachable: {endpoint} ({type(exc).__name__}: {exc})"
                ) from exc
    healthcheck = getattr(inputs.object_store, "healthcheck", None)
    if callable(healthcheck):
        healthcheck(bucket=inputs.processed_bucket)


def _ensure_prefetched_tokenizer_is_available(tokenizer_name: str) -> None:
    if not tokenizer_name.startswith("hf:"):
        return
    resolve_prefetched_hf_tokenizer_path(tokenizer_name.split(":", 1)[1])


def _resolve_validation_workers(source: dict[str, str]) -> int:
    raw_value = (source.get("HANDBOOK_CHUNK_VALIDATION_WORKERS") or "4").strip()
    try:
        return max(1, int(raw_value))
    except ValueError:
        return 4


def _resolve_validation_cache_dir(source: dict[str, str]) -> Path | None:
    configured = (source.get("HANDBOOK_VALIDATION_CACHE_DIR") or "").strip()
    if not configured:
        return None
    return Path(configured)


def _scan_all_documents(
    *,
    inputs: StudentHandbookValidationInputs,
    cache_dir: Path | None,
) -> tuple[StudentHandbookScannedDocument, ...]:
    workers = _resolve_validation_workers(inputs.source)
    if workers <= 1:
        return tuple(
            _scan_single_document(
                inputs=inputs,
                record=record,
                cache_dir=cache_dir,
            )
            for record in inputs.selected_records
        )
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = executor.map(
            lambda record: _scan_single_document(
                inputs=inputs,
                record=record,
                cache_dir=cache_dir,
            ),
            inputs.selected_records,
        )
        return tuple(results)


def _scan_sample_candidates_only(
    *,
    inputs: StudentHandbookValidationInputs,
    cache_dir: Path | None,
    sample_seed: int,
) -> tuple[StudentHandbookScannedDocument, ...]:
    pending_bucket_names = {bucket_name for bucket_name, _ in SAMPLE_BUCKETS}
    records = list(inputs.selected_records)
    rng = random.Random(sample_seed)
    rng.shuffle(records)
    documents: list[StudentHandbookScannedDocument] = []
    for record in records:
        document = _scan_single_document(
            inputs=inputs,
            record=record,
            cache_dir=cache_dir,
        )
        documents.append(document)
        if document.read_failure is not None or document.chunk_failure is not None or not document.chunks:
            continue
        candidate = _build_sample_candidate(document)
        for bucket_name, _ in SAMPLE_BUCKETS:
            if bucket_name not in pending_bucket_names:
                continue
            if _sample_candidate_matches_bucket(candidate, bucket_name=bucket_name):
                pending_bucket_names.remove(bucket_name)
        if not pending_bucket_names:
            break
    documents.sort(key=lambda document: document.record.document_id)
    return tuple(documents)


def _scan_single_document(
    *,
    inputs: StudentHandbookValidationInputs,
    record: DocumentRegistryRecord,
    cache_dir: Path | None,
) -> StudentHandbookScannedDocument:
    title = inputs.manifest_titles.get(record.document_id, record.document_id)
    if not record.document_units_object_key:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=(),
            chunks=(),
            read_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=None,
                error="document_units_object_key is missing",
            ),
        )
    try:
        structured_jsonl_bytes = _load_structured_jsonl_bytes(
            inputs=inputs,
            record=record,
            cache_dir=cache_dir,
        )
    except Exception as exc:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=(),
            chunks=(),
            read_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    rows = tuple(_load_rows(structured_jsonl_bytes))
    try:
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_jsonl_bytes,
            chunk_profile=inputs.chunk_profile,
        )
    except Exception as exc:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=rows,
            chunks=(),
            chunk_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    return StudentHandbookScannedDocument(
        title=title,
        record=record,
        rows=rows,
        chunks=chunks,
    )


def _load_structured_jsonl_bytes(
    *,
    inputs: StudentHandbookValidationInputs,
    record: DocumentRegistryRecord,
    cache_dir: Path | None,
) -> bytes:
    if cache_dir is not None:
        cache_path = _validation_cache_file_path(
            cache_dir=cache_dir,
            bucket=inputs.processed_bucket,
            key=record.document_units_object_key or "",
            version_id=record.version_id,
        )
        if cache_path.exists():
            return cache_path.read_bytes()
    payload = inputs.object_store.get_bytes(
        bucket=inputs.processed_bucket,
        key=record.document_units_object_key or "",
    )
    if cache_dir is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(payload)
    return payload


def _validation_cache_file_path(*, cache_dir: Path, bucket: str, key: str, version_id: str) -> Path:
    suffix = Path(key).name or "document-units.jsonl"
    digest = hashlib.sha1(f"{bucket}:{key}:{version_id}".encode("utf-8")).hexdigest()
    return cache_dir / bucket / digest / suffix


def _build_sample_candidate(document: StudentHandbookScannedDocument) -> StudentHandbookChunkSampleCandidate:
    split_reasons = Counter(str(chunk.metadata.get("split_reason") or "none") for chunk in document.chunks)
    unit_types = Counter(str(chunk.metadata.get("unit_type") or "unknown") for chunk in document.chunks)
    boundary_rules = Counter(str(chunk.metadata.get("boundary_rule") or "none") for chunk in document.chunks)
    return StudentHandbookChunkSampleCandidate(
        title=document.title,
        document_id=document.record.document_id,
        record=document.record,
        rows=document.rows,
        chunks=document.chunks,
        split_reasons=dict(split_reasons),
        unit_types=dict(unit_types),
        boundary_rules=dict(boundary_rules),
    )


def _sample_candidate_matches_bucket(
    candidate: StudentHandbookChunkSampleCandidate,
    *,
    bucket_name: str,
) -> bool:
    if bucket_name == "structure-boundary":
        return candidate.split_reasons.get("structure_boundary", 0) > 0
    if bucket_name == "token-guardrail":
        return candidate.split_reasons.get("token_guardrail", 0) > 0
    if bucket_name == "table":
        return any(candidate.unit_types.get(unit_type, 0) > 0 for unit_type in ("table", "table_row", "table_unit"))
    if bucket_name == "policy-page":
        return candidate.unit_types.get("policy_page", 0) > 0
    if bucket_name == "plain-article":
        return (
            candidate.unit_types.get("article_body", 0) > 0
            and candidate.split_reasons.get("structure_boundary", 0) == 0
            and candidate.split_reasons.get("token_guardrail", 0) == 0
            and candidate.unit_types.get("policy_page", 0) == 0
            and candidate.unit_types.get("table", 0) == 0
            and candidate.unit_types.get("table_row", 0) == 0
            and candidate.unit_types.get("table_unit", 0) == 0
        )
    return False


def _resolve_manifest_path(*, source: dict[str, str], manifest_path: Path | None) -> Path:
    if manifest_path is not None:
        return Path(manifest_path)
    configured = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
    if configured:
        return Path(configured)
    return DEFAULT_HANDBOOK_MANIFEST_PATH


def _build_validation_inputs(
    *,
    env: dict[str, str] | None,
    registry: DocumentRegistry | None,
    object_store: ChunkValidationArtifactReader | None,
    manifest_path: Path | None,
    chunk_profile: ChunkProfile | None,
) -> StudentHandbookValidationInputs:
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
    records = tuple(runtime_registry.list_by_scope(corpus, collection))
    records_by_doc: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        records_by_doc.setdefault(record.document_id, []).append(record)
    normalized_records_by_doc = {
        document_id: tuple(doc_records) for document_id, doc_records in records_by_doc.items()
    }
    selected_records = _select_source_faithful_records(records_by_doc)
    return StudentHandbookValidationInputs(
        source=source,
        chunk_profile=runtime_profile,
        registry=runtime_registry,
        object_store=runtime_object_store,
        processed_bucket=processed_bucket,
        manifest_path=split_manifest_path,
        manifest_titles=manifest_titles,
        records=records,
        records_by_doc=normalized_records_by_doc,
        selected_records=selected_records,
        extra_registry_document_ids=tuple(sorted(set(records_by_doc) - manifest_ids)),
        missing_registry_document_ids=tuple(sorted(manifest_ids - set(records_by_doc))),
    )


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


def _load_rows(structured_jsonl_bytes: bytes) -> list[dict[str, object]]:
    return [json.loads(line) for line in structured_jsonl_bytes.decode("utf-8").splitlines() if line.strip()]


def _pick_sample_candidates(
    candidates: list[StudentHandbookChunkSampleCandidate],
    *,
    sample_seed: int,
) -> list[tuple[str, str, StudentHandbookChunkSampleCandidate]]:
    rng = random.Random(sample_seed)
    chosen_ids: set[str] = set()
    picked: list[tuple[str, str, StudentHandbookChunkSampleCandidate]] = []

    def pick(predicate) -> StudentHandbookChunkSampleCandidate | None:
        eligible = [candidate for candidate in candidates if predicate(candidate) and candidate.document_id not in chosen_ids]
        if not eligible:
            return None
        return rng.choice(eligible)

    selectors = {
        "structure-boundary": lambda candidate: candidate.split_reasons.get("structure_boundary", 0) > 0,
        "token-guardrail": lambda candidate: candidate.split_reasons.get("token_guardrail", 0) > 0,
        "table": lambda candidate: any(candidate.unit_types.get(unit_type, 0) > 0 for unit_type in ("table", "table_row", "table_unit")),
        "policy-page": lambda candidate: candidate.unit_types.get("policy_page", 0) > 0,
        "plain-article": lambda candidate: (
            candidate.unit_types.get("article_body", 0) > 0
            and candidate.split_reasons.get("structure_boundary", 0) == 0
            and candidate.split_reasons.get("token_guardrail", 0) == 0
            and candidate.unit_types.get("policy_page", 0) == 0
            and candidate.unit_types.get("table", 0) == 0
            and candidate.unit_types.get("table_row", 0) == 0
            and candidate.unit_types.get("table_unit", 0) == 0
        ),
    }
    for bucket_name, bucket_reason in SAMPLE_BUCKETS:
        candidate = pick(selectors[bucket_name])
        if candidate is None:
            continue
        chosen_ids.add(candidate.document_id)
        picked.append((bucket_name, bucket_reason, candidate))
    return picked


def _render_sample(
    *,
    title: str,
    bucket_name: str,
    bucket_reason: str,
    record: DocumentRegistryRecord,
    rows: tuple[dict[str, object], ...],
    chunks: tuple[object, ...],
) -> str:
    embedding_rows = _filter_embedding_consumable_rows(rows)
    unit_type_counts = Counter(str(row.get("unit_type") or "") for row in embedding_rows)
    split_reason_counts = Counter(str(getattr(chunk, "metadata", {}).get("split_reason") or "none") for chunk in chunks)
    boundary_rule_counts = Counter(str(getattr(chunk, "metadata", {}).get("boundary_rule") or "none") for chunk in chunks)
    final_token_counts = [int(getattr(chunk, "metadata", {}).get("final_token_count") or 0) for chunk in chunks]

    lines: list[str] = [
        f"# {title}",
        "",
        f"- sample_bucket: `{bucket_name}`",
        f"- sample_reason: `{bucket_reason}`",
        f"- document_id: `{record.document_id}`",
        f"- version_id: `{record.version_id}`",
        f"- revision_track: `{record.revision_track}`",
        f"- document_units_key: `{record.document_units_object_key}`",
        f"- total_units: `{len(embedding_rows)}`",
        f"- total_chunks: `{len(chunks)}`",
        f"- unit_type_counts: `{dict(unit_type_counts)}`",
        f"- split_reason_counts: `{dict(split_reason_counts)}`",
        f"- boundary_rule_counts: `{dict(boundary_rule_counts)}`",
        f"- final_token_summary: `{_summarize_tokens(final_token_counts)}`",
        "",
        "## Units",
        "",
    ]
    for index, row in enumerate(embedding_rows, start=1):
        unit_label = str(row.get("root_unit_id") or row.get("chunk_id") or f"unit-{index:04d}")
        lines.extend(
            [
                f"### {unit_label}",
                "",
                f"- unit_type: `{_format_value(row.get('unit_type'))}`",
            ]
        )
        for key in ("section_path", "article_label", "table_context"):
            if key in row:
                lines.append(f"- {key}: `{_format_value(row.get(key))}`")
        lines.extend(
            [
                "",
                "```text",
                str(row.get("clean_text") or row.get("raw_text") or row.get("text") or ""),
                "```",
                "",
            ]
        )
    lines.extend(["## Chunks", ""])
    for chunk in chunks:
        metadata = getattr(chunk, "metadata", {})
        lines.extend([f"### {getattr(chunk, 'chunk_id', '<unknown>')}", ""])
        for key in (
            "unit_type",
            "split_reason",
            "boundary_rule",
            "header_mode",
            "header_token_count",
            "display_token_count",
            "final_token_count",
            "aggregation_mode",
            "member_unit_count",
            "member_article_labels",
            "section_path",
            "article_label",
            "table_context",
        ):
            if key in metadata:
                lines.append(f"- {key}: `{_format_value(metadata.get(key))}`")
        lines.extend(["", "```text", str(getattr(chunk, "text", "")), "```", ""])
    return "\n".join(lines).rstrip() + "\n"


def _filter_embedding_consumable_rows(rows: tuple[dict[str, object], ...]) -> tuple[dict[str, object], ...]:
    filtered: list[dict[str, object]] = []
    for row in rows:
        unit_type = str(row.get("unit_type") or "")
        if unit_type == "table":
            continue
        filtered.append(row)
    return tuple(filtered)


def _format_value(value: object) -> str:
    if value is None:
        return "None"
    if isinstance(value, str):
        return value
    return repr(value)


def _summarize_tokens(values: list[int]) -> dict[str, int]:
    ordered = sorted(int(value) for value in values)
    if not ordered:
        return {"min": 0, "p50": 0, "p90": 0, "p95": 0, "p99": 0, "max": 0}
    return {
        "min": ordered[0],
        "p50": _percentile(ordered, 50),
        "p90": _percentile(ordered, 90),
        "p95": _percentile(ordered, 95),
        "p99": _percentile(ordered, 99),
        "max": ordered[-1],
    }


def _percentile(values: list[int], percentile: int) -> int:
    if not values:
        return 0
    rank = math.ceil((percentile / 100) * len(values)) - 1
    rank = min(max(rank, 0), len(values) - 1)
    return values[rank]


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
        display_budget = resolve_display_budget(
            unit=StructuredUnitChunkInput(
                unit_type=unit_type,
                root_unit_id=str(row.get("root_unit_id") or row.get("chunk_id") or ""),
                text=text,
                anchor=row.get("anchor") if isinstance(row.get("anchor"), dict) else {},
                metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            ),
            chunk_profile=chunk_profile,
        )
        token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
        if token_count <= display_budget.max_tokens:
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
            display_budget=display_budget,
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
    if _looks_like_appendix_leaf_section_heading(tail):
        return True
    return tail == clean_text and tail.endswith(("。", "！", "？", "；"))


def _chunk_requires_context(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    unit_type = str(metadata.get("unit_type") or "")
    if unit_type in TABLE_UNIT_TYPES:
        return False
    return bool(metadata.get("title"))


def _is_textual_chunk(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    return str(metadata.get("unit_type") or "") in PARENT_UNIT_TYPES


def _chunk_header_ratio(*, header_token_count: int, final_token_count: int) -> float:
    if final_token_count <= 0:
        return 0.0
    return header_token_count / final_token_count


def _has_actionable_short_textual_merge_neighbor(
    *,
    chunks: Sequence[object],
    chunk_index: int,
    chunk_profile: ChunkProfile,
) -> bool:
    current = chunks[chunk_index]
    if not _is_merge_eligible_textual_chunk(current):
        return False
    for neighbor_index in (chunk_index - 1, chunk_index + 1):
        if neighbor_index < 0 or neighbor_index >= len(chunks):
            continue
        if _chunks_could_merge_for_validation(
            current=current,
            neighbor=chunks[neighbor_index],
            chunk_profile=chunk_profile,
        ):
            return True
    return False


def _chunks_could_merge_for_validation(
    *,
    current: object,
    neighbor: object,
    chunk_profile: ChunkProfile,
) -> bool:
    if not _is_merge_eligible_textual_chunk(neighbor):
        return False
    current_metadata = getattr(current, "metadata", {})
    neighbor_metadata = getattr(neighbor, "metadata", {})
    if not isinstance(current_metadata, dict) or not isinstance(neighbor_metadata, dict):
        return False
    if str(current_metadata.get("unit_type") or "") != str(neighbor_metadata.get("unit_type") or ""):
        return False
    if getattr(current, "acl_level", None) != getattr(neighbor, "acl_level", None):
        return False
    for field_name in ("title", "policy_doc_no"):
        if current_metadata.get(field_name) != neighbor_metadata.get(field_name):
            return False
    current_anchor = getattr(current, "anchor", {})
    neighbor_anchor = getattr(neighbor, "anchor", {})
    if not isinstance(current_anchor, dict) or not isinstance(neighbor_anchor, dict):
        return False
    if not _textual_chunk_paths_are_merge_compatible(
        unit_type=str(current_metadata.get("unit_type") or ""),
        current_anchor=current_anchor,
        neighbor_anchor=neighbor_anchor,
    ):
        return False
    merged_display_budget = (
        int(current_metadata.get("display_token_count") or 0)
        + int(neighbor_metadata.get("display_token_count") or 0)
        + max(
            int(current_metadata.get("header_token_count") or 0),
            int(neighbor_metadata.get("header_token_count") or 0),
        )
    )
    return merged_display_budget <= chunk_profile.max_chunk_size


def _is_merge_eligible_textual_chunk(chunk: object) -> bool:
    if not _is_textual_chunk(chunk):
        return False
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if metadata.get("split_reason") is not None:
        return False
    return int(metadata.get("segment_total") or 1) == 1


def _textual_chunk_paths_are_merge_compatible(
    *,
    unit_type: str,
    current_anchor: dict[str, object],
    neighbor_anchor: dict[str, object],
) -> bool:
    current_path = _normalize_section_path(current_anchor)
    neighbor_path = _normalize_section_path(neighbor_anchor)
    if current_path == neighbor_path:
        return True
    if (
        unit_type == "policy_page"
        and not _chunk_has_explicit_member_label(current_anchor)
        and not _chunk_has_explicit_member_label(neighbor_anchor)
    ):
        return _policy_page_paths_are_merge_compatible(current_path=current_path, neighbor_path=neighbor_path)
    return False


def _chunk_has_explicit_member_label(anchor: dict[str, object]) -> bool:
    return _normalize_anchor_label(anchor, "article_label") is not None or _normalize_anchor_label(
        anchor,
        "provision_label",
    ) is not None


def _policy_page_paths_are_merge_compatible(
    *,
    current_path: tuple[str, ...],
    neighbor_path: tuple[str, ...],
) -> bool:
    if not current_path or not neighbor_path:
        return False
    if len(current_path) >= 2 and neighbor_path[: len(current_path)] == current_path:
        return True
    if len(neighbor_path) >= 2 and current_path[: len(neighbor_path)] == neighbor_path:
        return True
    current_parent = current_path[:-1]
    neighbor_parent = neighbor_path[:-1]
    if len(current_parent) < 2 or len(neighbor_parent) < 2:
        return False
    return current_parent == neighbor_parent


def _normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def _normalize_anchor_label(anchor: dict[str, object], field_name: str) -> str | None:
    value = anchor.get(field_name)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _is_verbose_header_dominant_chunk(
    *,
    chunk: object,
    header_token_count: int,
    final_token_count: int,
) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if str(metadata.get("header_mode") or "") not in VERBOSE_HEADER_MODES:
        return False
    return _chunk_header_ratio(
        header_token_count=header_token_count,
        final_token_count=final_token_count,
    ) >= HEADER_DOMINANT_RATIO_THRESHOLD


def _is_header_only_table_chunk(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if str(metadata.get("unit_type") or "") != "table_unit":
        return False
    return int(metadata.get("table_row_count") or 0) == 0


def _has_generic_table_label(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    return "列=" in text or "未命名列" in text


def _has_broken_citation_linebreak(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str) or "\n" not in text:
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for previous, current in zip(lines, lines[1:]):
        if current[:1] in {"[", "〔", "(", "（"} and _has_unclosed_citation_context(previous):
            return True
        if previous.endswith(("民大校发", "民大学发", "民大党发", "中发", "教高")) and current[:1] in {"[", "〔"}:
            return True
    return False


def _has_unclosed_citation_context_in_chunk(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if line.startswith("标题：") or line.startswith("文号："):
            continue
        if _has_unclosed_citation_context(line):
            return True
    return False


def _has_heading_body_glue(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if _extract_validation_heading_body_glue(line) is not None:
            return True
    return False


def _has_adjacent_overlap_duplication(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        split_body = _extract_validation_heading_body_glue(line)
        if split_body is not None:
            if _find_boundary_overlap(split_body[0], split_body[1]):
                return True
            if len(_shared_cjk_prefix(split_body[0], split_body[1])) >= 2:
                return True
    return False


def _validation_line_body(line: str) -> str:
    stripped = line.strip()
    article_match = ARTICLE_PREFIX_RE.match(stripped)
    if article_match is not None:
        return article_match.group("rest").strip()
    match = VALIDATION_LIST_MARKER_RE.match(stripped)
    if match is not None:
        return match.group("body").strip()
    return stripped


def _extract_validation_heading_body_glue(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("标题：") or stripped.startswith("文号："):
        return None
    if " / " in stripped:
        return None
    body = _validation_line_body(stripped)
    if not body:
        return None
    split_body = _split_short_heading_from_body(body)
    if split_body is None:
        return None
    heading, remainder = split_body
    if remainder.startswith(heading):
        return split_body
    if _looks_like_title_like_heading_remainder(remainder):
        return split_body
    if any(
        starter != "无" and remainder.startswith(starter)
        for starter in SHORT_HEADING_BODY_STARTERS
    ):
        return split_body
    if remainder.startswith("无") and not remainder.startswith("无异议"):
        return split_body
    if heading in SHORT_HEADING_WHITELIST and _looks_like_title_like_heading_remainder(remainder):
        return split_body
    return None


def _detect_inline_overlap_duplication(text: str) -> str:
    compact = text.strip()
    max_overlap = min(len(compact) // 2, 8)
    for overlap_length in range(max_overlap, 2, -1):
        for index in range(overlap_length, len(compact) - overlap_length + 1):
            left = compact[index - overlap_length : index]
            right = compact[index : index + overlap_length]
            if left != right:
                continue
            if not re.fullmatch(r"[\u4e00-\u9fff]{3,8}", left):
                continue
            return left
    return ""


def _shared_cjk_prefix(left: str, right: str) -> str:
    shared_chars: list[str] = []
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        if not re.fullmatch(r"[\u4e00-\u9fff]", left_char):
            break
        shared_chars.append(left_char)
    return "".join(shared_chars)


__all__ = [
    "ChunkValidationArtifactReader",
    "ChunkValidationFailure",
    "DEFAULT_HANDBOOK_MANIFEST_PATH",
    "StudentHandbookChunkingScanResult",
    "StudentHandbookScannedDocument",
    "StudentHandbookValidationInputs",
    "StudentHandbookChunkingValidationReport",
    "build_student_handbook_chunking_validation_report",
    "export_student_handbook_chunk_samples",
    "scan_student_handbook_chunking",
    "validate_student_handbook_chunking",
]
