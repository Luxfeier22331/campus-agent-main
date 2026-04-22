from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.online_ocr_compare import (
    OnlineOcrCompareReport,
    OnlineOcrCompareRequest,
    compare_online_ocr,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a sidecar OCR compare job against a local file or registered raw asset"
    )
    parser.add_argument("--file-path")
    parser.add_argument("--raw-asset-id")
    parser.add_argument("--raw-version-id")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--baseline-provider-response-path")
    parser.add_argument("--baseline-provider-response-key")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = compare_online_ocr(
        request=OnlineOcrCompareRequest(
            file_path=Path(args.file_path).resolve() if args.file_path else None,
            raw_asset_id=args.raw_asset_id,
            raw_version_id=args.raw_version_id,
            output_dir=Path(args.output_dir),
            baseline_provider_response_path=(
                Path(args.baseline_provider_response_path).resolve()
                if args.baseline_provider_response_path
                else None
            ),
            baseline_provider_response_key=args.baseline_provider_response_key,
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "OnlineOcrCompareReport",
    "OnlineOcrCompareRequest",
    "build_parser",
    "compare_online_ocr",
    "main",
]


if __name__ == "__main__":
    main()
