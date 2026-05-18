from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_evals.regulation_answer_ready_component_live_runner import (
    run_component_eval_for_collection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run live answer-ready component eval for a regulation collection."
    )
    parser.add_argument(
        "--collection", choices=("student_rules", "institutional_rules"), required=True
    )
    parser.add_argument("--summary-output-path", required=True)
    parser.add_argument("--retrieval-observations-output-path")
    parser.add_argument("--qdrant-collection-name")
    parser.add_argument("--release-contract-status", default="passed")
    parser.add_argument("--release-contract-failure-class", action="append", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = run_component_eval_for_collection(
        collection=args.collection,
        summary_output_path=Path(args.summary_output_path),
        retrieval_observations_output_path=(
            Path(args.retrieval_observations_output_path)
            if args.retrieval_observations_output_path
            else None
        ),
        qdrant_collection_name=args.qdrant_collection_name,
        release_contract_status=args.release_contract_status,
        release_contract_failure_classes=tuple(args.release_contract_failure_class),
        repo_env=False,
    )
    print(
        json.dumps(
            {
                "schema_version": "regulation_answer_ready_component_eval_worker_report.v1",
                "collection": args.collection,
                "summary_output_path": args.summary_output_path,
                "retrieval_observations_output_path": args.retrieval_observations_output_path or "",
                "qdrant_collection_name": args.qdrant_collection_name or "",
                "report": {
                    "passed": report.passed,
                    "total": report.total,
                    "passed_count": report.passed_count,
                    "failed_count": report.failed_count,
                    "primary_failure_stage_counts": report.primary_failure_stage_counts,
                    "secondary_failure_stage_counts": report.secondary_failure_stage_counts,
                    "scope_failure_counts": report.scope_failure_counts,
                    "gate_failure_counts": report.gate_failure_counts,
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
