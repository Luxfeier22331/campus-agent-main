from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_batch_admission_audit import (
    RegulationAdmissionExpectation,
    audit_collected_notice_regulation_admission_batch,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit collected notice regulation admission for a selected notice batch"
    )
    parser.add_argument("--selection-json", required=True)
    parser.add_argument("--bundle-json", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--generated-at", default="")
    parser.add_argument(
        "--expect",
        action="append",
        default=[],
        help="Expectation in notice_id:regulation_admission_class:consumption_class form.",
    )
    parser.add_argument("--allow-missing", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = audit_collected_notice_regulation_admission_batch(
        selection_json=Path(args.selection_json),
        bundle_json=Path(args.bundle_json),
        output_dir=Path(args.output_dir),
        generated_at=args.generated_at or utc_now(),
        expectations=tuple(_parse_expectation(value) for value in args.expect),
        allow_missing=args.allow_missing,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _parse_expectation(value: str) -> RegulationAdmissionExpectation:
    parts = value.split(":")
    if len(parts) != 3 or not all(part.strip() for part in parts):
        raise ValueError("--expect must use notice_id:regulation_admission_class:consumption_class")
    return RegulationAdmissionExpectation(
        notice_id=parts[0].strip(),
        regulation_admission_class=parts[1].strip(),
        consumption_class=parts[2].strip(),
    )


__all__ = [
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
