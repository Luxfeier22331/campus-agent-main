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
    DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS,
    PHASE_09_ID,
    build_admission_preflight_report,
    build_first_batch_regulation_selection_from_paths,
    build_serving_closed_assertion,
    build_source_to_target_trace,
    materialize_first_batch_regulation_selection,
    write_phase09_evidence_files,
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
DEFAULT_PHASE_06_R3_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r3-regulation-normalization-quality-gate"
)
DEFAULT_PHASE_09_OUTPUT_DIR = Path(
    "var/ingestion-evidence/authenticated-notice-regulation-consumption/"
    "evidence/phase-09-first-batch-regulation-promotion-write-gate"
)


@dataclass(frozen=True, slots=True)
class FirstBatchRegulationPromotionRequest:
    candidate_audit_path: Path
    consistency_report_path: Path
    institutional_materialization_path: Path
    scoped_materialization_path: Path
    output_dir: Path
    notice_ids: tuple[str, ...] = DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS
    execute: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_audit_path", Path(self.candidate_audit_path))
        object.__setattr__(self, "consistency_report_path", Path(self.consistency_report_path))
        object.__setattr__(
            self,
            "institutional_materialization_path",
            Path(self.institutional_materialization_path),
        )
        object.__setattr__(
            self,
            "scoped_materialization_path",
            Path(self.scoped_materialization_path),
        )
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "notice_ids",
            tuple(sorted({str(item).strip() for item in self.notice_ids if str(item).strip()})),
        )


def promote_collected_notice_regulation_first_batch(
    *,
    request: FirstBatchRegulationPromotionRequest,
    env: Mapping[str, str] | None = None,
    object_store: Any | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> dict[str, Any]:
    source = dict(env if env is not None else os.environ)
    runtime_object_store = object_store or build_runtime_object_store(source)
    runtime_document_registry = document_registry or build_runtime_document_registry(source)
    runtime_raw_asset_registry = raw_asset_registry or build_runtime_raw_asset_registry(source)

    selection = build_first_batch_regulation_selection_from_paths(
        candidate_audit_path=request.candidate_audit_path,
        consistency_report_path=request.consistency_report_path,
        institutional_materialization_path=request.institutional_materialization_path,
        scoped_materialization_path=request.scoped_materialization_path,
        selected_notice_ids=request.notice_ids,
    )
    admission_preflight = build_admission_preflight_report(selection=selection)
    institutional_materialization = _load_json_object(request.institutional_materialization_path)
    scoped_materialization = _load_json_object(request.scoped_materialization_path)
    materialization_report = materialize_first_batch_regulation_selection(
        selection=selection,
        institutional_materialization=institutional_materialization,
        scoped_materialization=scoped_materialization,
        registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        object_store=runtime_object_store,
        execute=request.execute,
        env=source,
    )
    preflight_snapshot = _snapshot_from_materialization_report(
        materialization_report,
        key="target_scope_preflight_document_counts",
    )
    postflight_snapshot = _snapshot_from_materialization_report(
        materialization_report,
        key="target_scope_postflight_document_counts",
    )
    source_to_target_trace = build_source_to_target_trace(selection=selection)
    serving_closed = build_serving_closed_assertion()
    files = write_phase09_evidence_files(
        output_dir=request.output_dir,
        selection=selection,
        admission_preflight_report=admission_preflight,
        materialization_report=materialization_report,
        preflight_snapshot=preflight_snapshot,
        postflight_snapshot=postflight_snapshot,
        source_to_target_trace=source_to_target_trace,
        serving_closed_assertion=serving_closed,
    )
    return {
        "schema_version": "collected_notice_regulation_first_batch_worker.v1",
        "phase": PHASE_09_ID,
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Promote the selected first batch of collected-notice regulation candidates "
            "through the Phase 9 write gate."
        )
    )
    parser.add_argument(
        "--candidate-audit-path",
        default=str(DEFAULT_PHASE_06_R1_DIR / "regulation-candidate-audit.json"),
    )
    parser.add_argument(
        "--consistency-report-path",
        default=str(DEFAULT_PHASE_06_R3_DIR / "regulation-normalization-consistency-report.json"),
    )
    parser.add_argument(
        "--institutional-materialization-path",
        default=str(
            DEFAULT_PHASE_06_R3_DIR / "institutional-rules-materialization.normalized.dry-run.json"
        ),
    )
    parser.add_argument(
        "--scoped-materialization-path",
        default=str(
            DEFAULT_PHASE_06_R3_DIR / "scoped-rules-materialization.normalized.dry-run.json"
        ),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_09_OUTPUT_DIR))
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    notice_ids = (
        tuple(args.notice_ids) if args.notice_ids else DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS
    )
    report = promote_collected_notice_regulation_first_batch(
        request=FirstBatchRegulationPromotionRequest(
            candidate_audit_path=Path(args.candidate_audit_path),
            consistency_report_path=Path(args.consistency_report_path),
            institutional_materialization_path=Path(args.institutional_materialization_path),
            scoped_materialization_path=Path(args.scoped_materialization_path),
            output_dir=Path(args.output_dir),
            notice_ids=notice_ids,
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


def _snapshot_from_materialization_report(
    materialization_report: Mapping[str, Any],
    *,
    key: str,
) -> dict[str, Any]:
    return {
        "schema_version": "collected_notice_regulation_first_batch_target_snapshot.v1",
        "phase": PHASE_09_ID,
        "mode": materialization_report.get("mode"),
        "write_enabled": materialization_report.get("write_enabled"),
        "target_scope_document_counts": dict(materialization_report.get(key) or {}),
        "query_serving_opened": False,
        "rag_release_opened": False,
    }


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


__all__ = [
    "FirstBatchRegulationPromotionRequest",
    "build_parser",
    "build_runtime_document_registry",
    "build_runtime_object_store",
    "build_runtime_raw_asset_registry",
    "main",
    "promote_collected_notice_regulation_first_batch",
]


if __name__ == "__main__":
    main()
