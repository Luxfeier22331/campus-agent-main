from __future__ import annotations

import argparse
import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_file_release_inventory_backfill import (
    AuthenticatedNoticeFileReleaseInventoryBackfillRequest,
    backfill_authenticated_notice_file_release_inventory,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill authenticated notice file-release inventory into PG"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="file_release_capture")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request = AuthenticatedNoticeFileReleaseInventoryBackfillRequest(
        bundle_path=Path(args.bundle_path),
        manifest_path=Path(args.manifest_path),
        corpus=args.corpus,
        collection=args.collection,
    )
    result = backfill_authenticated_notice_file_release_inventory(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "AuthenticatedNoticeFileReleaseInventoryBackfillRequest",
    "backfill_authenticated_notice_file_release_inventory",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
