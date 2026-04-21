from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from campus_ingestion_core import validate_official_web_projection_output

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate official_web projection replay output.")
    parser.add_argument("--projection-output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = validate_official_web_projection_output(Path(args.projection_output_dir).resolve())
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    if not report.valid:
        raise SystemExit(1)


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
