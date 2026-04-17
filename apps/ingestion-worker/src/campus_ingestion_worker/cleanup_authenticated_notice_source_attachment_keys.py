from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.authenticated_notice_attachment_key_cleanup import (
    AuthenticatedNoticeAttachmentKeyCleanupRequest,
    cleanup_authenticated_notice_source_attachment_keys,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Delete unreferenced legacy authenticated notice attachment objects"
    )
    parser.add_argument("--unreferenced-inventory-path", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    payload = cleanup_authenticated_notice_source_attachment_keys(
        request=AuthenticatedNoticeAttachmentKeyCleanupRequest(
            unreferenced_inventory_path=Path(args.unreferenced_inventory_path),
            output_dir=Path(args.output_dir),
        )
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeAttachmentKeyCleanupRequest",
    "build_parser",
    "cleanup_authenticated_notice_source_attachment_keys",
    "main",
]


if __name__ == "__main__":
    main()
