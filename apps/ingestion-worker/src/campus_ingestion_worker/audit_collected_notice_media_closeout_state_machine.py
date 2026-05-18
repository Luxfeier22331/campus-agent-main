from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_media_closeout_state_machine_audit import (
    build_collected_notice_media_closeout_state_machine_audit_from_paths,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit media closeout, target admission, cleanup, and object verification state."
    )
    parser.add_argument("--candidate-inventory-path", required=True)
    parser.add_argument("--attempt-ledger-path")
    parser.add_argument("--closeout-candidate-inventory-path")
    parser.add_argument("--target-admission-manifest-path", action="append", default=[])
    parser.add_argument("--cleanup-report-path")
    parser.add_argument("--object-verification-report-path")
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    audit = build_collected_notice_media_closeout_state_machine_audit_from_paths(
        candidate_inventory_path=Path(args.candidate_inventory_path),
        attempt_ledger_path=Path(args.attempt_ledger_path) if args.attempt_ledger_path else None,
        closeout_candidate_inventory_path=(
            Path(args.closeout_candidate_inventory_path)
            if args.closeout_candidate_inventory_path
            else None
        ),
        target_admission_manifest_paths=[
            Path(path) for path in args.target_admission_manifest_path
        ],
        cleanup_report_path=Path(args.cleanup_report_path) if args.cleanup_report_path else None,
        object_verification_report_path=(
            Path(args.object_verification_report_path)
            if args.object_verification_report_path
            else None
        ),
        strict_gate=True,
    )
    output_path = output_dir / "media-closeout-state-machine-audit.json"
    output_path.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output_path": str(output_path),
                "verdict": audit["verdict"],
                "candidate_count": audit["candidate_count"],
                "attempt_count": audit["attempt_count"],
                "finding_count": audit["finding_count"],
                "finding_counts_by_severity": audit["finding_counts_by_severity"],
                "finding_counts_by_code": audit["finding_counts_by_code"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )
    if audit["verdict"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
