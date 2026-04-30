from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.retrieval_release_benchmark import (
    build_retrieval_release_benchmark_report_from_jsonl,
    retrieval_release_benchmark_report_to_dict,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a dry-run retrieval release benchmark report."
    )
    parser.add_argument("--chunks", required=True, help="Path to chunk JSONL.")
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--scale-multiplier", type=int, default=1)
    parser.add_argument("--embedding-cache-hit-count", type=int, default=0)
    parser.add_argument("--output", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = build_retrieval_release_benchmark_report_from_jsonl(
        chunks_path=args.chunks,
        corpus=args.corpus,
        collection=args.collection,
        scale_multiplier=args.scale_multiplier,
        embedding_cache_hit_count=args.embedding_cache_hit_count,
        mode="dry_run",
    )
    payload = retrieval_release_benchmark_report_to_dict(report)
    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
