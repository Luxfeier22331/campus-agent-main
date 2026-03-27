from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.benchmark import (
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    summarize_retrieval_metrics,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic retrieval benchmark against qrels.")
    parser.add_argument("--qrels", required=True, help="Path to retrieval qrels JSON fixture.")
    parser.add_argument("--results", required=True, help="Path to observed retrieval results JSON.")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render summary as text or JSON.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    dataset = load_retrieval_qrels_dataset(Path(args.qrels))
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
