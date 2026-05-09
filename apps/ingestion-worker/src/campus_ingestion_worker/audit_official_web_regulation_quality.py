from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core import (
    OfficialWebRegulationQualityAuditDocumentReport,
    OfficialWebRegulationQualityAuditReport,
    audit_official_web_regulation_batch_quality,
    official_web_regulation_quality_audit_report_to_dict,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit official_web public regulation materialization quality from a local "
            "collector-output artifact."
        )
    )
    parser.add_argument("--source-truth-output-dir", required=True)
    parser.add_argument("--projection-output-dir", required=True)
    parser.add_argument("--declarations-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = audit_official_web_regulation_batch_quality(
        source_truth_output_dir=Path(args.source_truth_output_dir).resolve(),
        projection_output_dir=Path(args.projection_output_dir).resolve(),
        declarations_path=(
            Path(args.declarations_path).resolve() if args.declarations_path is not None else None
        ),
    )
    print(
        json.dumps(
            official_web_regulation_quality_audit_report_to_dict(report),
            ensure_ascii=False,
            indent=2,
        )
    )


__all__ = [
    "OfficialWebRegulationQualityAuditDocumentReport",
    "OfficialWebRegulationQualityAuditReport",
    "audit_official_web_regulation_batch_quality",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
