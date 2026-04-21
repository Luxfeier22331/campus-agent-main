from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from campus_ingestion_core import (
    DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
    build_internal_notice_chunking_validation_report,
    export_internal_notice_chunk_samples,
    scan_internal_notice_chunking,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate internal_notice offline preparation quality without embeddings or indexing"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    selection_group = parser.add_mutually_exclusive_group()
    selection_group.add_argument("--preparation-run-id")
    selection_group.add_argument("--closeout-run-id")
    parser.add_argument("--mode", choices=("full", "samples"), default="full")
    parser.add_argument("--sample-dir")
    parser.add_argument("--sample-seed", type=int, default=DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.corpus != "campus_notices" or args.collection != "internal_notice":
        raise ValueError(
            "validate_internal_notice_chunking only supports campus_notices/internal_notice"
        )
    scan_result = scan_internal_notice_chunking(
        preparation_run_id=args.preparation_run_id,
        closeout_run_id=args.closeout_run_id,
        mode=args.mode,
        sample_seed=args.sample_seed,
    )
    sample_dir: str | None = None
    if args.sample_dir:
        sample_dir = str(
            export_internal_notice_chunk_samples(
                output_dir=Path(args.sample_dir),
                scan_result=scan_result,
                sample_seed=args.sample_seed,
            )
        )
    if scan_result.mode == "samples":
        print(
            json.dumps(
                {
                    "mode": "samples",
                    "selection_mode": scan_result.inputs.selection_mode,
                    "preparation_run_id": scan_result.inputs.preparation_run_id,
                    "closeout_run_id": scan_result.inputs.closeout_run_id,
                    "scanned_document_count": len(scan_result.documents),
                    "sample_dir": sample_dir,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    report = build_internal_notice_chunking_validation_report(scan_result=scan_result)
    payload = asdict(report)
    payload["sample_dir"] = sample_dir
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
