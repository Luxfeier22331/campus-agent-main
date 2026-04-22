from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import replay_official_web_source_truth_local

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Replay official_web local source-truth output into canonical document artifacts."
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--projection-output-dir", required=True)
    parser.add_argument("--declarations-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = replay_official_web_source_truth_local(
        output_dir=Path(args.output_dir).resolve(),
        projection_output_dir=Path(args.projection_output_dir).resolve(),
        declarations_path=(
            Path(args.declarations_path).resolve() if args.declarations_path else None
        ),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
