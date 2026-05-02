from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_regulation_canonical_backfill import (
    DEFAULT_MANUAL_REVIEW_RESOLUTIONS,
    PHASE_13_ID,
    CollectedNoticeRegulationCanonicalBackfillRequest,
    backfill_collected_notice_regulation_canonical,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS,
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
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1-regulation-candidate-audit-and-admission"
)
DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1b-regulation-owner-text-recovery-execution/"
    "regulation-owner-text-execution-report.json"
)
DEFAULT_PHASE_13_OUTPUT_DIR = Path(
    ".planning/workstreams/authenticated-notice-regulation-consumption/"
    "evidence/phase-13-historical-regulation-canonical-backfill"
)


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationCanonicalBackfillWorkerRequest:
    first_batch_candidate_audit_path: Path
    first_batch_admission_manifest_path: Path
    manual_review_candidate_audit_path: Path
    manual_review_owner_text_execution_report_path: Path
    output_dir: Path
    first_batch_notice_ids: tuple[str, ...] = DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS
    manual_review_resolutions: Mapping[str, object] = field(
        default_factory=lambda: dict(DEFAULT_MANUAL_REVIEW_RESOLUTIONS)
    )
    execute: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "first_batch_candidate_audit_path",
            Path(self.first_batch_candidate_audit_path),
        )
        object.__setattr__(
            self,
            "first_batch_admission_manifest_path",
            Path(self.first_batch_admission_manifest_path),
        )
        object.__setattr__(
            self,
            "manual_review_candidate_audit_path",
            Path(self.manual_review_candidate_audit_path),
        )
        object.__setattr__(
            self,
            "manual_review_owner_text_execution_report_path",
            Path(self.manual_review_owner_text_execution_report_path),
        )
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "first_batch_notice_ids",
            tuple(
                sorted(
                    {
                        str(item).strip()
                        for item in self.first_batch_notice_ids
                        if str(item).strip()
                    }
                )
            ),
        )
        object.__setattr__(
            self,
            "manual_review_resolutions",
            {
                str(notice_id).strip(): value
                for notice_id, value in self.manual_review_resolutions.items()
                if str(notice_id).strip()
            },
        )


def backfill_collected_notice_regulation_canonical_from_paths(
    *,
    request: CollectedNoticeRegulationCanonicalBackfillWorkerRequest,
    env: Mapping[str, str] | None = None,
    object_store: Any | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> dict[str, Any]:
    source = dict(env if env is not None else os.environ)
    runtime_object_store = object_store or build_runtime_object_store(source)
    runtime_document_registry = document_registry or build_runtime_document_registry(source)
    runtime_raw_asset_registry = raw_asset_registry or build_runtime_raw_asset_registry(source)
    report = backfill_collected_notice_regulation_canonical(
        request=CollectedNoticeRegulationCanonicalBackfillRequest(
            first_batch_candidate_audit=_load_json_object(
                request.first_batch_candidate_audit_path
            ),
            first_batch_admission_manifest=_load_json_object(
                request.first_batch_admission_manifest_path
            ),
            manual_review_candidate_audit=_load_json_object(
                request.manual_review_candidate_audit_path
            ),
            manual_review_owner_text_execution_report=_load_json_object(
                request.manual_review_owner_text_execution_report_path
            ),
            manual_review_resolutions=request.manual_review_resolutions,
            first_batch_notice_ids=request.first_batch_notice_ids,
            execute=request.execute,
        ),
        env=source,
        object_store=runtime_object_store,
        document_registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
    )
    files = write_phase13_evidence_files(output_dir=request.output_dir, report=report)
    return {
        "schema_version": "collected_notice_regulation_canonical_backfill_worker.v1",
        "phase": PHASE_13_ID,
        "mode": report["mode"],
        "write_enabled": report["write_enabled"],
        "execute": request.execute,
        "selected_notice_ids": report["selected_notice_ids"],
        "selected_target_document_ids": report["selected_target_document_ids"],
        "materialized_document_count": report["materialized_document_count"],
        "query_serving_opened": False,
        "rag_release_opened": False,
        "output_dir": str(request.output_dir),
        "files": {name: str(path) for name, path in sorted(files.items())},
    }


def write_phase13_evidence_files(
    *,
    output_dir: Path,
    report: Mapping[str, Any],
) -> dict[str, Path]:
    files: dict[str, Mapping[str, Any]] = {
        "canonical-backfill-report.json": report,
    }
    artifacts = report.get("artifacts")
    if isinstance(artifacts, Mapping):
        for batch_id, batch_artifacts in artifacts.items():
            if not isinstance(batch_artifacts, Mapping):
                continue
            files.update(_batch_artifact_files(str(batch_id), batch_artifacts))
    written: dict[str, Path] = {}
    for filename, payload in files.items():
        path = output_dir / filename
        _write_json(path, payload)
        written[filename] = path
    return written


def _batch_artifact_files(
    batch_id: str,
    artifacts: Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    prefix = "first-batch" if batch_id == "first_batch" else "manual-review"
    files: dict[str, Mapping[str, Any]] = {}
    name_by_key = {
        "selection": "selected-batch-selection.json",
        "admission_preflight_report": "admission-preflight-report.json",
        "institutional_materialization": "institutional-rules-materialization.normalized.dry-run.json",
        "scoped_materialization": "scoped-rules-materialization.normalized.dry-run.json",
        "normalization_quality_report": "regulation-normalization-quality-report.json",
        "consistency_report": "regulation-normalization-consistency-report.json",
        "source_preview_trace": "regulation-source-to-target-trace.json",
        "materialization_report": "materialization.execute.json",
        "source_to_target_trace": "source-to-target-provenance-trace.json",
        "serving_closed_assertion": "serving-closed-assertion.json",
        "manual_review_resolution_report": "manual-review-resolution-report.json",
        "manual_review_resolved_admission_manifest": "manual-review-resolved-admission-manifest.json",
        "manual_review_resolved_candidate_audit": "manual-review-resolved-candidate-audit.json",
    }
    for key, filename in name_by_key.items():
        payload = artifacts.get(key)
        if isinstance(payload, Mapping):
            files[f"{prefix}/{filename}"] = payload
    return files


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Re-materialize historical collected-notice regulation targets through "
            "the current canonical cleaner before RAG release."
        )
    )
    parser.add_argument(
        "--first-batch-candidate-audit-path",
        default=str(DEFAULT_PHASE_06_R1_DIR / "regulation-candidate-audit.json"),
    )
    parser.add_argument(
        "--first-batch-admission-manifest-path",
        default=str(DEFAULT_PHASE_06_R1_DIR / "regulation-consumer-admission-manifest.json"),
    )
    parser.add_argument(
        "--manual-review-candidate-audit-path",
        default=str(DEFAULT_PHASE_06_R1_DIR / "regulation-candidate-audit.json"),
    )
    parser.add_argument(
        "--manual-review-owner-text-execution-report-path",
        default=str(DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_13_OUTPUT_DIR))
    parser.add_argument("--first-batch-notice-id", action="append", default=[])
    parser.add_argument(
        "--manual-review-resolution",
        action="append",
        default=[],
        help="Manual review resolution in notice_id=target_collection form.",
    )
    parser.add_argument(
        "--no-manual-review",
        action="store_true",
        help="Skip the legacy manual-review branch; use first-batch admission as the sole input.",
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    first_batch_notice_ids = (
        tuple(args.first_batch_notice_id)
        if args.first_batch_notice_id
        else DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS
    )
    if args.no_manual_review:
        manual_review_resolutions = {}
    else:
        manual_review_resolutions = (
            _parse_resolutions(args.manual_review_resolution)
            if args.manual_review_resolution
            else dict(DEFAULT_MANUAL_REVIEW_RESOLUTIONS)
        )
    report = backfill_collected_notice_regulation_canonical_from_paths(
        request=CollectedNoticeRegulationCanonicalBackfillWorkerRequest(
            first_batch_candidate_audit_path=Path(args.first_batch_candidate_audit_path),
            first_batch_admission_manifest_path=Path(args.first_batch_admission_manifest_path),
            manual_review_candidate_audit_path=Path(args.manual_review_candidate_audit_path),
            manual_review_owner_text_execution_report_path=Path(
                args.manual_review_owner_text_execution_report_path
            ),
            output_dir=Path(args.output_dir),
            first_batch_notice_ids=first_batch_notice_ids,
            manual_review_resolutions=manual_review_resolutions,
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


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "PHASE_13_ID",
    "CollectedNoticeRegulationCanonicalBackfillWorkerRequest",
    "backfill_collected_notice_regulation_canonical_from_paths",
    "build_parser",
    "build_runtime_document_registry",
    "build_runtime_object_store",
    "build_runtime_raw_asset_registry",
    "main",
    "write_phase13_evidence_files",
]


if __name__ == "__main__":
    main()
