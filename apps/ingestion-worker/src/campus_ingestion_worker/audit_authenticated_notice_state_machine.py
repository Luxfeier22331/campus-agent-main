from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_state_machine_audit import (
    build_authenticated_notice_state_machine_audit_from_paths,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit authenticated notice retention and downstream state-machine outputs"
    )
    parser.add_argument("--searchable-notice-preview-path", required=True)
    parser.add_argument("--multimodal-candidate-inventory-path", required=True)
    parser.add_argument("--fetch-request-manifest-path")
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    audit = build_authenticated_notice_state_machine_audit_from_paths(
        searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
        multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
        fetch_request_manifest_path=(
            Path(args.fetch_request_manifest_path) if args.fetch_request_manifest_path else None
        ),
    )
    output_path = output_dir / "state-machine-audit.json"
    output_path.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    summary = {
        "output_path": str(output_path),
        "verdict": audit["verdict"],
        "unit_count": audit["unit_count"],
        "candidate_count": audit["candidate_count"],
        "finding_count": audit["finding_count"],
        "finding_counts_by_severity": audit["finding_counts_by_severity"],
        "finding_counts_by_code": audit["finding_counts_by_code"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
