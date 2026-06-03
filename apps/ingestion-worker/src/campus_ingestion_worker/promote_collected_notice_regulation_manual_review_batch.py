from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    build_admission_preflight_report,
    build_first_batch_regulation_selection,
    build_serving_closed_assertion,
    build_source_to_target_trace,
    materialize_first_batch_regulation_selection,
)
from campus_ingestion_core.collected_notice_regulation_manual_review_admission import (
    PHASE_11_ID,
    build_manual_review_regulation_admission_from_paths,
)
from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    build_collected_notice_regulation_materialization_preview,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_06_R1_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1-regulation-candidate-audit-and-admission"
)
DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1b-regulation-owner-text-recovery-execution/"
    "regulation-owner-text-execution-report.json"
)
DEFAULT_PHASE_11_OUTPUT_DIR = Path(
    "var/ingestion-evidence/authenticated-notice-regulation-consumption/"
    "evidence/phase-11-second-batch-manual-review-admission"
)
DEFAULT_MANUAL_REVIEW_RESOLUTIONS = {
    "481": "scoped_rules",
    "619": "institutional_rules",
}
_IMPORT_SOURCE = "collected_notice_regulation_manual_review_promotion"
_PARSER_VERSION = "collected_notice_regulation_manual_review_promotion_v1"


@dataclass(frozen=True, slots=True)
class ManualReviewRegulationPromotionRequest:
    candidate_audit_path: Path
    owner_text_execution_report_path: Path
    output_dir: Path
    resolutions: Mapping[str, object]
    execute: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_audit_path", Path(self.candidate_audit_path))
        object.__setattr__(
            self,
            "owner_text_execution_report_path",
            Path(self.owner_text_execution_report_path),
        )
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "resolutions",
            {
                str(notice_id).strip(): value
                for notice_id, value in self.resolutions.items()
                if str(notice_id).strip()
            },
        )


def promote_collected_notice_regulation_manual_review_batch(
    *,
    request: ManualReviewRegulationPromotionRequest,
    env: Mapping[str, str] | None = None,
    object_store: Any | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> dict[str, Any]:
    source = dict(env if env is not None else os.environ)
    runtime_object_store = object_store or build_runtime_object_store(source)
    runtime_document_registry = document_registry or build_runtime_document_registry(source)
    runtime_raw_asset_registry = raw_asset_registry or build_runtime_raw_asset_registry(source)

    admission = build_manual_review_regulation_admission_from_paths(
        candidate_audit_path=request.candidate_audit_path,
        owner_text_execution_report_path=request.owner_text_execution_report_path,
        resolutions=request.resolutions,
    )
    preview = build_collected_notice_regulation_materialization_preview(
        admission_manifest=admission["admission_manifest"],
        object_store=runtime_object_store,
        phase_id=PHASE_11_ID,
        generated_by=(
            "campus_ingestion_worker.promote_collected_notice_regulation_manual_review_batch"
        ),
        evidence_refs={
            "manual_review_resolution_report": "manual-review-resolution-report.json",
            "candidate_audit": str(request.candidate_audit_path),
            "owner_text_execution_report": str(request.owner_text_execution_report_path),
        },
    )
    selection = build_first_batch_regulation_selection(
        candidate_audit=admission["candidate_audit"],
        consistency_report=preview.consistency_report,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        selected_notice_ids=tuple(request.resolutions),
        phase_id=PHASE_11_ID,
    )
    admission_preflight = build_admission_preflight_report(
        selection=selection,
        phase_id=PHASE_11_ID,
    )
    materialization_report = materialize_first_batch_regulation_selection(
        selection=selection,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        object_store=runtime_object_store,
        execute=request.execute,
        env=source,
        phase_id=PHASE_11_ID,
        import_source=_IMPORT_SOURCE,
        parser_version=_PARSER_VERSION,
    )
    source_to_target_trace = build_source_to_target_trace(
        selection=selection,
        phase_id=PHASE_11_ID,
    )
    serving_closed = build_serving_closed_assertion(phase_id=PHASE_11_ID)
    files = write_phase11_evidence_files(
        output_dir=request.output_dir,
        resolution_report=admission["resolution_report"],
        resolved_admission_manifest=admission["admission_manifest"],
        resolved_candidate_audit=admission["candidate_audit"],
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        normalization_quality_report=preview.normalization_quality_report,
        consistency_report=preview.consistency_report,
        selection=selection,
        admission_preflight_report=admission_preflight,
        materialization_report=materialization_report,
        source_to_target_trace=source_to_target_trace,
        serving_closed_assertion=serving_closed,
    )
    return {
        "schema_version": "collected_notice_regulation_manual_review_worker.v1",
        "phase": PHASE_11_ID,
        "mode": materialization_report["mode"],
        "write_enabled": materialization_report["write_enabled"],
        "execute": request.execute,
        "selected_notice_ids": materialization_report["selected_notice_ids"],
        "selected_target_document_ids": materialization_report["selected_target_document_ids"],
        "materialized_document_count": materialization_report["materialized_document_count"],
        "query_serving_opened": False,
        "rag_release_opened": False,
        "output_dir": str(request.output_dir),
        "files": {name: str(path) for name, path in sorted(files.items())},
    }


def write_phase11_evidence_files(
    *,
    output_dir: Path,
    resolution_report: Mapping[str, Any],
    resolved_admission_manifest: Mapping[str, Any],
    resolved_candidate_audit: Mapping[str, Any],
    institutional_materialization: Mapping[str, Any],
    scoped_materialization: Mapping[str, Any],
    normalization_quality_report: Mapping[str, Any],
    consistency_report: Mapping[str, Any],
    selection: Mapping[str, Any],
    admission_preflight_report: Mapping[str, Any],
    materialization_report: Mapping[str, Any],
    source_to_target_trace: Mapping[str, Any],
    serving_closed_assertion: Mapping[str, Any],
) -> dict[str, Path]:
    files: dict[str, Mapping[str, Any]] = {
        "manual-review-resolution-report.json": resolution_report,
        "manual-review-resolved-admission-manifest.json": resolved_admission_manifest,
        "manual-review-resolved-candidate-audit.json": resolved_candidate_audit,
        "institutional-rules-materialization.normalized.dry-run.json": (
            institutional_materialization
        ),
        "scoped-rules-materialization.normalized.dry-run.json": scoped_materialization,
        "regulation-normalization-quality-report.json": normalization_quality_report,
        "regulation-normalization-consistency-report.json": consistency_report,
        "selected-batch-selection.json": selection,
        "admission-preflight-report.json": admission_preflight_report,
        "materialization.execute.json": materialization_report,
        "source-to-target-provenance-trace.json": source_to_target_trace,
        "serving-closed-assertion.json": serving_closed_assertion,
    }
    written: dict[str, Path] = {}
    for filename, payload in files.items():
        path = output_dir / filename
        _write_json(path, payload)
        written[filename] = path
    return written


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Promote explicitly resolved manual-review regulation notices."
    )
    parser.add_argument(
        "--candidate-audit-path",
        default=str(DEFAULT_PHASE_06_R1_DIR / "regulation-candidate-audit.json"),
    )
    parser.add_argument(
        "--owner-text-execution-report-path",
        default=str(DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_11_OUTPUT_DIR))
    parser.add_argument(
        "--resolution",
        action="append",
        default=[],
        help="Manual review resolution in notice_id=target_collection form.",
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    resolutions = (
        _parse_resolutions(args.resolution)
        if args.resolution
        else dict(DEFAULT_MANUAL_REVIEW_RESOLUTIONS)
    )
    report = promote_collected_notice_regulation_manual_review_batch(
        request=ManualReviewRegulationPromotionRequest(
            candidate_audit_path=Path(args.candidate_audit_path),
            owner_text_execution_report_path=Path(args.owner_text_execution_report_path),
            output_dir=Path(args.output_dir),
            resolutions=resolutions,
            execute=args.execute,
        )
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def build_runtime_object_store(env: Mapping[str, str]) -> S3ObjectStoreWriter:
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env(dict(env)))


def build_runtime_document_registry(env: Mapping[str, str]) -> DocumentRegistry:
    return build_document_registry_from_env(dict(env), prefer_operator=True)


def build_runtime_raw_asset_registry(env: Mapping[str, str]) -> RawAssetRegistry:
    return build_raw_asset_registry_from_env(dict(env), prefer_operator=True)


def _parse_resolutions(values: Sequence[str]) -> dict[str, str]:
    resolutions: dict[str, str] = {}
    for value in values:
        notice_id, separator, target_collection = str(value).partition("=")
        if separator != "=":
            raise ValueError(f"resolution must use notice_id=target_collection: {value}")
        notice_id = notice_id.strip()
        target_collection = target_collection.strip()
        if not notice_id or not target_collection:
            raise ValueError(f"resolution must use notice_id=target_collection: {value}")
        resolutions[notice_id] = target_collection
    return resolutions


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "DEFAULT_MANUAL_REVIEW_RESOLUTIONS",
    "PHASE_11_ID",
    "ManualReviewRegulationPromotionRequest",
    "build_parser",
    "build_runtime_document_registry",
    "build_runtime_object_store",
    "build_runtime_raw_asset_registry",
    "main",
    "promote_collected_notice_regulation_manual_review_batch",
    "write_phase11_evidence_files",
]


if __name__ == "__main__":
    main()
