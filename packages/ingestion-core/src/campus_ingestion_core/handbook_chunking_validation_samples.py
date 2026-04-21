from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.chunking import TABLE_UNIT_TYPES, ChunkProfile
from campus_ingestion_core.handbook_chunking_validation_report import (
    build_student_handbook_chunking_validation_report,
)
from campus_ingestion_core.handbook_chunking_validation_scan import (
    scan_student_handbook_chunking,
)
from campus_ingestion_core.handbook_chunking_validation_shared import (
    SAMPLE_BUCKETS,
    ChunkValidationArtifactReader,
    StudentHandbookChunkingScanResult,
    StudentHandbookChunkingValidationReport,
    StudentHandbookChunkSampleCandidate,
    _filter_embedding_consumable_rows,
    _format_value,
    _sample_candidate_matches_bucket,
    _summarize_tokens,
)
from campus_ingestion_core.registry import DocumentRegistry


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
        split_reasons = Counter(
            str(chunk.metadata.get("split_reason") or "none") for chunk in chunks
        )
        unit_types = Counter(str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks)
        boundary_rules = Counter(
            str(chunk.metadata.get("boundary_rule") or "none") for chunk in chunks
        )
        for chunk in chunks:
            header_tokens.append(int(chunk.metadata.get("header_token_count") or 0))
            display_tokens.append(int(chunk.metadata.get("display_token_count") or 0))
            final_tokens.append(int(chunk.metadata.get("final_token_count") or 0))
            if (
                str(chunk.metadata.get("unit_type") or "") not in TABLE_UNIT_TYPES
                and int(chunk.metadata.get("final_token_count") or 0)
                > runtime_profile.max_chunk_size
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
        f"- boilerplate_policy_page_count: `{runtime_report.boilerplate_policy_page_count if runtime_report is not None else 'n/a'}`",
        f"- weak_appendix_textual_chunk_count: `{runtime_report.weak_appendix_textual_chunk_count if runtime_report is not None else 'n/a'}`",
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


def _pick_sample_candidates(
    candidates: list[StudentHandbookChunkSampleCandidate],
    *,
    sample_seed: int,
) -> list[tuple[str, str, StudentHandbookChunkSampleCandidate]]:
    rng = random.Random(sample_seed)
    chosen_ids: set[str] = set()
    picked: list[tuple[str, str, StudentHandbookChunkSampleCandidate]] = []
    for bucket_name, bucket_reason in SAMPLE_BUCKETS:
        eligible = [
            candidate
            for candidate in candidates
            if candidate.document_id not in chosen_ids
            and _sample_candidate_matches_bucket(candidate, bucket_name=bucket_name)
        ]
        if not eligible:
            continue
        candidate = rng.choice(eligible)
        chosen_ids.add(candidate.document_id)
        picked.append((bucket_name, bucket_reason, candidate))
    return picked


def _render_sample(
    *,
    title: str,
    bucket_name: str,
    bucket_reason: str,
    record: object,
    rows: tuple[dict[str, object], ...],
    chunks: tuple[object, ...],
) -> str:
    embedding_rows = _filter_embedding_consumable_rows(rows)
    unit_type_counts = Counter(str(row.get("unit_type") or "") for row in embedding_rows)
    split_reason_counts = Counter(
        str(getattr(chunk, "metadata", {}).get("split_reason") or "none") for chunk in chunks
    )
    boundary_rule_counts = Counter(
        str(getattr(chunk, "metadata", {}).get("boundary_rule") or "none") for chunk in chunks
    )
    final_token_counts = [
        int(getattr(chunk, "metadata", {}).get("final_token_count") or 0) for chunk in chunks
    ]

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
