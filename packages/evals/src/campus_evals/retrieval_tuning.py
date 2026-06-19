from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from campus_shared import load_repo_env

from campus_evals.benchmark_tuning import (
    build_retrieval_tuning_report,
    render_retrieval_tuning_report_text,
    retrieval_tuning_report_to_dict,
)
from campus_evals.langfuse_score_report import (
    build_score_report_from_retrieval_tuning_report,
    write_langfuse_score_report,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a deterministic retrieval tuning report from qrels and candidate runs."
    )
    parser.add_argument("--qrels", required=True, help="Path to retrieval qrels JSON fixture.")
    parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help=(
            "Path to a retrieval tuning candidate run JSON. Repeat for each dense/sparse/RRF/"
            "no-hit profile candidate."
        ),
    )
    parser.add_argument(
        "--manifest",
        help="Optional split or retrieval-eval manifest path used for qrels validation.",
    )
    parser.add_argument(
        "--runtime-profile",
        help="Optional production runtime-profile.json used as the profile patch baseline.",
    )
    parser.add_argument("--output", required=True, help="Path to write tuning report JSON.")
    parser.add_argument(
        "--langfuse-score-report",
        help="Optional path to write a langfuse_score_report.v1 artifact for the tuning report.",
    )
    parser.add_argument("--langfuse-environment")
    parser.add_argument("--langfuse-release")
    parser.add_argument("--source-git-head")
    parser.add_argument("--dataset-run-id")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render report as text or JSON on stdout.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    args = build_parser().parse_args(argv)
    try:
        report = build_retrieval_tuning_report(
            qrels_path=Path(args.qrels),
            candidate_paths=tuple(Path(item) for item in args.candidate),
            manifest_path=Path(args.manifest) if args.manifest else None,
            runtime_profile_path=Path(args.runtime_profile) if args.runtime_profile else None,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    payload = retrieval_tuning_report_to_dict(report)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if args.langfuse_score_report:
        try:
            score_report = build_score_report_from_retrieval_tuning_report(
                tuning_report_payload=payload,
                tuning_report_path=output_path,
                environment=str(args.langfuse_environment or ""),
                release=str(args.langfuse_release or ""),
                source_git_head=str(args.source_git_head or ""),
                dataset_run_id=str(args.dataset_run_id or ""),
            )
            write_langfuse_score_report(Path(args.langfuse_score_report), score_report)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_retrieval_tuning_report_text(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
