from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_routing_taxonomy_eval import (
    evaluate_authenticated_notice_routing_taxonomy_jsonl,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_AUTHENTICATED_NOTICE_ROUTING_TAXONOMY_EVAL_PATH = (
    Path(__file__).resolve().parents[4]
    / "configs/ingestion/campus_notices/internal_notice/routing-taxonomy-eval.v1.jsonl"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate authenticated notice routing taxonomy from JSONL fixtures."
    )
    parser.add_argument(
        "--fixture-path",
        type=Path,
        default=DEFAULT_AUTHENTICATED_NOTICE_ROUTING_TAXONOMY_EVAL_PATH,
    )
    parser.add_argument("--config-path", type=Path)
    parser.add_argument("--min-accuracy", type=float, default=1.0)
    parser.add_argument("--fail-on-error", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    config_path = (
        args.config_path
        if args.config_path is not None
        else read_authenticated_notice_notice_family_config_path(dict(os.environ))
    )
    config = load_authenticated_notice_notice_family_config(config_path)
    report = evaluate_authenticated_notice_routing_taxonomy_jsonl(
        args.fixture_path.read_bytes(),
        config=config,
        min_accuracy=args.min_accuracy,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))
    if args.fail_on_error and not report.ok:
        return 1
    return 0


__all__ = [
    "DEFAULT_AUTHENTICATED_NOTICE_ROUTING_TAXONOMY_EVAL_PATH",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
