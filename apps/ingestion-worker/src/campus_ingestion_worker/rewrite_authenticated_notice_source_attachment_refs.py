from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_ref_rewrite import (
    AuthenticatedNoticeAttachmentRefRewriteRequest,
    rewrite_authenticated_notice_source_attachment_refs,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rewrite authenticated notice attachment refs and provider observations to canonical source keys"
    )
    parser.add_argument("--referenced-inventory-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--max-concurrency", type=int, default=8)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = rewrite_authenticated_notice_source_attachment_refs(
        request=AuthenticatedNoticeAttachmentRefRewriteRequest(
            referenced_inventory_path=Path(args.referenced_inventory_path),
            output_dir=Path(args.output_dir),
            notice_ids=tuple(str(item).strip() for item in args.notice_id if str(item).strip()),
        ),
        max_concurrency=args.max_concurrency,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeAttachmentRefRewriteRequest",
    "build_parser",
    "main",
    "rewrite_authenticated_notice_source_attachment_refs",
]


if __name__ == "__main__":
    main()
