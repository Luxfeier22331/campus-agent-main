from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from typing import Sequence

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_core import LocalDataRebuildReport, RebuildRequest, rebuild_local_data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a typed local rebuild request")
    parser.add_argument("--mode", required=True, choices=("raw_online_ocr", "provider_response_replay"))
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--raw-asset-id")
    parser.add_argument("--raw-version-id")
    parser.add_argument("--source-pdf")
    parser.add_argument("--reset-qdrant", action="store_true")
    parser.add_argument("--index-qdrant", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request = RebuildRequest(
        corpus=args.corpus,
        collection=args.collection,
        import_mode=args.mode,
        raw_asset_id=args.raw_asset_id,
        raw_version_id=args.raw_version_id,
        source_pdf=args.source_pdf,
        reset_qdrant=args.reset_qdrant,
        index_qdrant=args.index_qdrant,
    )
    report = rebuild_local_data(request=request)
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["LocalDataRebuildReport", "RebuildRequest", "build_parser", "rebuild_local_data", "main"]


if __name__ == "__main__":
    main()
