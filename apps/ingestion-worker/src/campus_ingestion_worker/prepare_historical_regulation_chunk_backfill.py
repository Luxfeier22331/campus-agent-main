from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    prepare_historical_regulation_chunk_backfill_chunks,
)
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_0_DIR = Path(
    ".planning/workstreams/historical-regulation-canonical-chunk-backfill/"
    "evidence/phase-00-chunk-only-boundary-and-inventory"
)
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/historical-regulation-canonical-chunk-backfill/"
    "evidence/phase-04-chunk-preparation-batch"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare chunk-only evidence for historical regulation backfill targets "
            "without candidate enqueue, embedding, index release, or alias publish."
        )
    )
    parser.add_argument("--phase0-dir", default=str(DEFAULT_PHASE_0_DIR))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--preparation-run-id-prefix",
        default="historical-regulation-chunk-backfill",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    phase0_dir = Path(args.phase0_dir)
    output_dir = Path(args.output_dir)
    object_store_settings = ObjectStoreSettings.from_env()
    evidence = prepare_historical_regulation_chunk_backfill_chunks(
        classification_report=_load_json_object(phase0_dir / "classification-report.json"),
        canonical_preflight=_load_json_object(phase0_dir / "canonical-provenance-preflight.json"),
        registry=build_document_registry_from_env(prefer_operator=True),
        object_store=S3ObjectStoreWriter(object_store_settings),
        output_dir=output_dir,
        bucket_derived=object_store_settings.bucket_derived,
        preparation_run_id_prefix=args.preparation_run_id_prefix,
    )
    files = write_chunk_backfill_evidence_files(output_dir=output_dir, evidence=evidence)
    payload = {
        "schema_version": "historical-regulation-chunk-backfill-chunk-worker.v1",
        "output_dir": str(output_dir),
        "files": {key: str(value) for key, value in sorted(files.items())},
        "chunk_preparation_batch_report": evidence["chunk_preparation_batch_report"],
        "serving_closed": evidence["serving_closed_assertion"],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def write_chunk_backfill_evidence_files(
    *,
    output_dir: Path,
    evidence: Mapping[str, Any],
) -> dict[str, Path]:
    files = {
        "chunk-preparation-batch-report.json": output_dir / "chunk-preparation-batch-report.json",
        "serving-closed-assertion.json": output_dir / "serving-closed-assertion.json",
        "candidate-store-noop-assertion.json": output_dir / "candidate-store-noop-assertion.json",
    }
    _write_json(
        files["chunk-preparation-batch-report.json"],
        evidence["chunk_preparation_batch_report"],
    )
    _write_json(files["serving-closed-assertion.json"], evidence["serving_closed_assertion"])
    _write_json(
        files["candidate-store-noop-assertion.json"],
        evidence["candidate_store_noop_assertion"],
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
    "DEFAULT_PHASE_0_DIR",
    "build_parser",
    "main",
    "write_chunk_backfill_evidence_files",
]


if __name__ == "__main__":
    main()
