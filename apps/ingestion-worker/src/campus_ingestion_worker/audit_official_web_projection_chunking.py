from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import audit_official_web_projection_chunking

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit local official_web projection output for cleaning and chunking quality.",
    )
    parser.add_argument("--projection-output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = audit_official_web_projection_chunking(
        projection_output_dir=Path(args.projection_output_dir).resolve(),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["audit_official_web_projection_chunking", "build_parser", "main"]


if __name__ == "__main__":
    main()
