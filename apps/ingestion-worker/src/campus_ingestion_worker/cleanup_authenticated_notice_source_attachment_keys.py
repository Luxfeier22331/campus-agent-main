from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_key_cleanup import (
    AuthenticatedNoticeAttachmentKeyCleanupRequest,
    AuthenticatedNoticeQuarantineAttachmentCleanupRequest,
    cleanup_authenticated_notice_quarantine_attachment_keys,
    cleanup_authenticated_notice_source_attachment_keys,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Delete unreferenced authenticated notice legacy attachment objects and write deletion evidence"
    )
    parser.add_argument("--unreferenced-inventory-path")
    parser.add_argument("--quarantine-attachment-refs-path")
    parser.add_argument("--media-extraction-candidate-inventory-path")
    parser.add_argument("--now")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.dry_run and not args.yes:
        parser.error("pass --yes to execute authenticated notice attachment cleanup")
    if bool(args.unreferenced_inventory_path) == bool(args.quarantine_attachment_refs_path):
        parser.error(
            "pass exactly one of --unreferenced-inventory-path or --quarantine-attachment-refs-path"
        )
    if args.quarantine_attachment_refs_path:
        if not args.now:
            parser.error("--now is required with --quarantine-attachment-refs-path")
        result = cleanup_authenticated_notice_quarantine_attachment_keys(
            request=AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                attachment_refs_path=Path(args.quarantine_attachment_refs_path),
                media_extraction_candidate_inventory_path=(
                    Path(args.media_extraction_candidate_inventory_path)
                    if args.media_extraction_candidate_inventory_path
                    else None
                ),
                output_dir=Path(args.output_dir),
                now=str(args.now),
                dry_run=bool(args.dry_run),
            )
        )
    else:
        result = cleanup_authenticated_notice_source_attachment_keys(
            request=AuthenticatedNoticeAttachmentKeyCleanupRequest(
                unreferenced_inventory_path=Path(args.unreferenced_inventory_path),
                output_dir=Path(args.output_dir),
                dry_run=bool(args.dry_run),
            )
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeAttachmentKeyCleanupRequest",
    "AuthenticatedNoticeQuarantineAttachmentCleanupRequest",
    "build_parser",
    "cleanup_authenticated_notice_quarantine_attachment_keys",
    "cleanup_authenticated_notice_source_attachment_keys",
    "main",
]


if __name__ == "__main__":
    main()
