from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.internal_notice_multimodal_eval import (
    evaluate_internal_notice_multimodal_visual_jsonl,
)

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_VISUAL_EVAL_PATH = (
    Path(__file__).resolve().parents[4]
    / "configs/ingestion/campus_notices/internal_notice/multimodal-visual-eval.v1.jsonl"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate internal_notice multimodal visual understanding fixtures"
    )
    parser.add_argument(
        "jsonl_path",
        nargs="?",
        type=Path,
        default=DEFAULT_INTERNAL_NOTICE_MULTIMODAL_VISUAL_EVAL_PATH,
    )
    parser.add_argument("--min-pass-rate", type=float, default=1.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    report = evaluate_internal_notice_multimodal_visual_jsonl(
        args.jsonl_path.read_bytes(),
        min_pass_rate=args.min_pass_rate,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.ok else 1


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_VISUAL_EVAL_PATH",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
