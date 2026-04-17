from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.authenticated_notice_attachment_object_backfill import (
    AuthenticatedNoticeAttachmentObjectBackfillRequest,
    backfill_authenticated_notice_attachment_objects,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill authenticated notice attachment source objects from a collector blob-store"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--blob-root", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--max-concurrency", type=int, default=8)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = backfill_authenticated_notice_attachment_objects(
        request=AuthenticatedNoticeAttachmentObjectBackfillRequest(
            bundle_path=Path(args.bundle_path),
            blob_root=Path(args.blob_root),
            notice_ids=tuple(str(item).strip() for item in args.notice_id if str(item).strip()),
        ),
        max_concurrency=args.max_concurrency,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeAttachmentObjectBackfillRequest",
    "backfill_authenticated_notice_attachment_objects",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
