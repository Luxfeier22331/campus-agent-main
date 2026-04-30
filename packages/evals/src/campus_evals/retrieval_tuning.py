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
    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_retrieval_tuning_report_text(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
