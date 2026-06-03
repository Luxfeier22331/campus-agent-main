from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.historical_regulation_denominator_expansion import (
    build_historical_regulation_denominator_expansion_audit,
)

DEFAULT_BATCH_CONFIG_PATH = Path(
    "configs/ingestion/campus_notices/internal_notice/historical-batches/"
    "run14-policy-regulation-expanded.v1.json"
)
DEFAULT_COHORT_MANIFEST_PATH = Path(
    "packages/evals/fixtures/historical_regulation_denominator_expansion/"
    "run14-policy-regulation-cohorts.json"
)
DEFAULT_WRAPPER_FOLLOW_UP_PATH = Path(
    "packages/evals/fixtures/historical_regulation_denominator_expansion/"
    "wrapper-follow-up-manifest.json"
)
DEFAULT_COMPLETED_V9_ADMISSION_MANIFEST_PATH = Path(
    "packages/evals/fixtures/historical_regulation_denominator_expansion/"
    "completed-v9-regulation-consumer-admission-manifest.json"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/historical-regulation-denominator-expansion/phase-00-denominator-audit"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit already-collected regulation-like notices for historical "
            "canonical/chunk expansion without opening release lanes."
        )
    )
    parser.add_argument("--batch-config-path", default=str(DEFAULT_BATCH_CONFIG_PATH))
    parser.add_argument("--cohort-manifest-path", default=str(DEFAULT_COHORT_MANIFEST_PATH))
    parser.add_argument(
        "--wrapper-follow-up-path",
        default=str(DEFAULT_WRAPPER_FOLLOW_UP_PATH),
    )
    parser.add_argument(
        "--completed-v9-admission-manifest-path",
        default=str(DEFAULT_COMPLETED_V9_ADMISSION_MANIFEST_PATH),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    audit = build_historical_regulation_denominator_expansion_audit(
        batch_config=_load_json_object(Path(args.batch_config_path)),
        cohort_manifest=_load_json_object(Path(args.cohort_manifest_path)),
        wrapper_follow_up_manifest=_load_json_object(Path(args.wrapper_follow_up_path)),
        completed_v9_admission_manifest=_load_json_object(
            Path(args.completed_v9_admission_manifest_path)
        ),
    )
    files = write_phase00_evidence_files(output_dir=Path(args.output_dir), audit=audit)
    print(
        json.dumps(
            {
                "schema_version": "historical-regulation-denominator-expansion-worker.v1",
                "output_dir": str(args.output_dir),
                "files": {name: str(path) for name, path in sorted(files.items())},
                "input_notice_count": audit["input_notice_count"],
                "status_counts": audit["status_counts"],
                "ready_notice_ids": audit["ready_notice_ids"],
                "serving_closed": audit["serving_closed_assertion"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_phase00_evidence_files(
    *,
    output_dir: Path,
    audit: Mapping[str, Any],
) -> dict[str, Path]:
    files = {
        "denominator-audit.json": output_dir / "denominator-audit.json",
        "serving-closed-assertion.json": output_dir / "serving-closed-assertion.json",
        "candidate-store-noop-assertion.json": output_dir / "candidate-store-noop-assertion.json",
        "ready-canonical-chunk-candidates.json": output_dir
        / "ready-canonical-chunk-candidates.json",
        "recovery-backlog.json": output_dir / "recovery-backlog.json",
    }
    _write_json(files["denominator-audit.json"], audit)
    _write_json(files["serving-closed-assertion.json"], audit["serving_closed_assertion"])
    _write_json(
        files["candidate-store-noop-assertion.json"],
        audit["candidate_store_noop_assertion"],
    )
    _write_json(
        files["ready-canonical-chunk-candidates.json"],
        {
            "schema_version": "historical_regulation_ready_candidates.v1",
            "generated_at": audit["generated_at"],
            "batch_id": audit["batch_id"],
            "ready_notice_ids": audit["ready_notice_ids"],
            "records": [
                dict(record)
                for record in audit["records"]
                if record.get("status") == "ready_for_canonical_chunk_v9"
            ],
        },
    )
    _write_json(
        files["recovery-backlog.json"],
        {
            "schema_version": "historical_regulation_recovery_backlog.v1",
            "generated_at": audit["generated_at"],
            "batch_id": audit["batch_id"],
            "records": [
                dict(record)
                for record in audit["records"]
                if record.get("status") != "ready_for_canonical_chunk_v9"
            ],
        },
    )
    return files


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
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
    "build_parser",
    "main",
    "write_phase00_evidence_files",
]


if __name__ == "__main__":
    main()
