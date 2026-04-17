from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.authenticated_notice_attachment_key_copy import (
    AuthenticatedNoticeAttachmentKeyCopyRequest,
    copy_authenticated_notice_source_attachment_keys,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Copy referenced authenticated notice legacy attachment objects to canonical source keys"
    )
    parser.add_argument("--mapping-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--max-concurrency", type=int, default=8)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = copy_authenticated_notice_source_attachment_keys(
        request=AuthenticatedNoticeAttachmentKeyCopyRequest(
            mapping_path=Path(args.mapping_path),
            output_dir=Path(args.output_dir),
            notice_ids=tuple(str(item).strip() for item in args.notice_id if str(item).strip()),
        ),
        max_concurrency=args.max_concurrency,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeAttachmentKeyCopyRequest",
    "build_parser",
    "copy_authenticated_notice_source_attachment_keys",
    "main",
]


if __name__ == "__main__":
    main()
