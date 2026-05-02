from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_historical_regulation_chunk_backfill_evidence,
)
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_13_DIR = Path(
    ".planning/workstreams/authenticated-notice-regulation-consumption/"
    "evidence/phase-13-historical-regulation-canonical-backfill"
)
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/historical-regulation-canonical-chunk-backfill/"
    "evidence/phase-00-chunk-only-boundary-and-inventory"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Plan historical regulation canonical chunk backfill without opening "
            "candidate enqueue, embedding, index release, or alias publish."
        )
    )
    parser.add_argument(
        "--phase13-report-path",
        default=str(DEFAULT_PHASE_13_DIR / "canonical-backfill-report.json"),
    )
    parser.add_argument(
        "--first-batch-materialization-path",
        default=str(DEFAULT_PHASE_13_DIR / "first-batch/materialization.execute.json"),
    )
    parser.add_argument(
        "--manual-review-materialization-path",
        default=str(DEFAULT_PHASE_13_DIR / "manual-review/materialization.execute.json"),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--preparation-run-id-prefix",
        default="historical-regulation-chunk-backfill",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    object_store_settings = ObjectStoreSettings.from_env()
    evidence = build_historical_regulation_chunk_backfill_evidence(
        phase13_report=_load_json_object(Path(args.phase13_report_path)),
        materialization_reports={
            "first-batch": _load_json_object(Path(args.first_batch_materialization_path)),
            "manual-review": _load_json_object(Path(args.manual_review_materialization_path)),
        },
        registry=build_document_registry_from_env(prefer_operator=True),
        object_store=S3ObjectStoreWriter(object_store_settings),
        bucket_derived=object_store_settings.bucket_derived,
        preparation_run_id_prefix=args.preparation_run_id_prefix,
    )
    files = write_phase0_evidence_files(output_dir=Path(args.output_dir), evidence=evidence)
    payload = {
        "schema_version": "historical-regulation-chunk-backfill-phase0-worker.v1",
        "output_dir": str(args.output_dir),
        "files": {key: str(value) for key, value in sorted(files.items())},
        "target_count": evidence["target_inventory"].get("target_count", 0),
        "classification_counts": evidence["classification_report"].get("status_counts", {}),
        "canonical_preflight_verdict": evidence["canonical_provenance_preflight"].get(
            "overall_verdict", ""
        ),
        "serving_closed": evidence["serving_closed_assertion"],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def write_phase0_evidence_files(
    *,
    output_dir: Path,
    evidence: Mapping[str, Any],
) -> dict[str, Path]:
    files: dict[str, Path] = {
        "target-inventory.json": output_dir / "target-inventory.json",
        "classification-report.json": output_dir / "classification-report.json",
        "canonical-provenance-preflight.json": output_dir / "canonical-provenance-preflight.json",
        "serving-closed-assertion.json": output_dir / "serving-closed-assertion.json",
        "candidate-store-noop-assertion.json": output_dir / "candidate-store-noop-assertion.json",
        "chunk-only-execution-plan.md": output_dir / "chunk-only-execution-plan.md",
    }
    _write_json(files["target-inventory.json"], evidence["target_inventory"])
    _write_json(files["classification-report.json"], evidence["classification_report"])
    _write_json(
        files["canonical-provenance-preflight.json"],
        evidence["canonical_provenance_preflight"],
    )
    _write_json(files["serving-closed-assertion.json"], evidence["serving_closed_assertion"])
    _write_json(
        files["candidate-store-noop-assertion.json"],
        evidence["candidate_store_noop_assertion"],
    )
    files["chunk-only-execution-plan.md"].parent.mkdir(parents=True, exist_ok=True)
    files["chunk-only-execution-plan.md"].write_text(
        str(evidence["chunk_only_execution_plan_md"]),
        encoding="utf-8",
    )
    return files


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "DEFAULT_OUTPUT_DIR",
    "DEFAULT_PHASE_13_DIR",
    "build_parser",
    "main",
    "write_phase0_evidence_files",
]


if __name__ == "__main__":
    main()
