from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from campus_ingestion_core.authenticated_notice_closeout_store import (
    CloseoutStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_chunking_validation_report import (
    build_internal_notice_chunking_validation_report,
)
from campus_ingestion_core.internal_notice_chunking_validation_samples import (
    _InternalNoticeChunkSampleCandidate,
    _pick_sample_candidates,
    _pick_sample_documents,
    _render_sample,
)
from campus_ingestion_core.internal_notice_chunking_validation_scan import (
    _build_validation_inputs,
    _scan_all_documents,
)
from campus_ingestion_core.internal_notice_chunking_validation_shared import (
    DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
    InternalNoticeChunkingScanResult,
    InternalNoticeChunkingValidationReport,
    InternalNoticeChunkValidationArtifactReader,
    InternalNoticeChunkValidationFailure,
    InternalNoticeScannedDocument,
    InternalNoticeValidationInputs,
    _safe_filename,
)
from campus_ingestion_core.registry import DocumentRegistry


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
