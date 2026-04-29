from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.internal_notice_multimodal_eval import (
    evaluate_internal_notice_multimodal_decisions_jsonl,
)

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_DECISION_EVAL_PATH = (
    Path(__file__).resolve().parents[4]
    / "configs/ingestion/campus_notices/internal_notice/multimodal-decision-eval.v1.jsonl"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate internal_notice multimodal processing decisions from JSONL"
    )
    parser.add_argument(
        "jsonl_path",
        nargs="?",
        type=Path,
        default=DEFAULT_INTERNAL_NOTICE_MULTIMODAL_DECISION_EVAL_PATH,
    )
    parser.add_argument("--min-accuracy", type=float, default=1.0)
    parser.add_argument("--max-needs-additional-processing-rate", type=float, default=0.34)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    report = evaluate_internal_notice_multimodal_decisions_jsonl(
        args.jsonl_path.read_bytes(),
        min_accuracy=args.min_accuracy,
        max_needs_additional_processing_rate=args.max_needs_additional_processing_rate,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.ok else 1


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_DECISION_EVAL_PATH",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
