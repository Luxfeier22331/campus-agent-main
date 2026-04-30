from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.retrieval_monitoring import (
    build_retrieval_monitoring_backlog,
    load_retrieval_runtime_observations_jsonl,
    retrieval_monitoring_backlog_to_dict,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build retrieval monitoring backlog candidates from sanitized runtime observations."
    )
    parser.add_argument(
        "--observations",
        required=True,
        help="Path to sanitized retrieval runtime observation JSONL.",
    )
    parser.add_argument("--output", required=True, help="Path to write backlog JSON.")
    parser.add_argument("--low-score-threshold", type=float, default=0.6)
    parser.add_argument("--low-score-gap-threshold", type=float, default=0.1)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    observations = load_retrieval_runtime_observations_jsonl(args.observations)
    report = build_retrieval_monitoring_backlog(
        observations=observations,
        low_score_threshold=args.low_score_threshold,
        low_score_gap_threshold=args.low_score_gap_threshold,
    )
    Path(args.output).write_text(
        json.dumps(retrieval_monitoring_backlog_to_dict(report), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
