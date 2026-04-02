from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from campus_shared import load_repo_env
from campus_evals.benchmark import (
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    resolve_retrieval_fixture_manifest_path,
    summarize_retrieval_metrics,
    validate_retrieval_qrels_fixture,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic retrieval benchmark against qrels.")
    parser.add_argument("--qrels", required=True, help="Path to retrieval qrels JSON fixture.")
    parser.add_argument("--results", required=True, help="Path to observed retrieval results JSON.")
    parser.add_argument("--manifest", help="Optional split-manifest path used for qrels validation.")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render summary as text or JSON.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    args = build_parser().parse_args(argv)
    qrels_path = Path(args.qrels)
    manifest_path = Path(args.manifest) if args.manifest else resolve_retrieval_fixture_manifest_path(qrels_path)
    issues = validate_retrieval_qrels_fixture(
        qrels_path,
        manifest_path=manifest_path,
        ambiguity_severity="error",
    )
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        return 2
    dataset = load_retrieval_qrels_dataset(qrels_path)
    run = load_retrieval_benchmark_run(Path(args.results))
    metrics = evaluate_retrieval_run(dataset, run)
    summary = summarize_retrieval_metrics(metrics)
    if args.format == "json":
        print(
            json.dumps(
                {
                    "total_cases": summary.total_cases,
                    "hit_at_1": summary.hit_at_1,
                    "hit_at_3": summary.hit_at_3,
                    "recall_at_5": summary.recall_at_5,
                    "precision_at_5": summary.precision_at_5,
                    "mrr_at_5": summary.mrr_at_5,
                    "forbidden_hit_rate": summary.forbidden_hit_rate,
                    "by_split": {
                        name: {
                            "total_cases": item.total_cases,
                            "hit_at_1": item.hit_at_1,
                            "hit_at_3": item.hit_at_3,
                            "recall_at_5": item.recall_at_5,
                            "precision_at_5": item.precision_at_5,
                            "mrr_at_5": item.mrr_at_5,
                            "forbidden_hit_rate": item.forbidden_hit_rate,
                        }
                        for name, item in summary.by_split.items()
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(render_retrieval_summary_text(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
