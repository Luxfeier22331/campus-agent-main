from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_object_locator_audit import (
    AuthenticatedNoticeObjectLocatorAuditRequest,
    audit_authenticated_notice_object_locators,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit authenticated notice object locators without writing stores"
    )
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--file-release-id", action="append", default=[])
    parser.add_argument("--skip-notice", action="store_true")
    parser.add_argument("--skip-file-release-capture", action="store_true")
    parser.add_argument("--skip-file-release-source", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    source = dict(os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    output_path = Path(args.output_path)
    report = audit_authenticated_notice_object_locators(
        request=AuthenticatedNoticeObjectLocatorAuditRequest(
            source_bucket=object_store_settings.bucket_source,
            notice_ids=tuple(str(item).strip() for item in args.notice_id if str(item).strip()),
            file_release_ids=tuple(
                str(item).strip() for item in args.file_release_id if str(item).strip()
            ),
            include_notice=not args.skip_notice,
            include_file_release_capture=not args.skip_file_release_capture,
            include_file_release_source=not args.skip_file_release_source,
            output_path=output_path,
        ),
        object_store=S3ObjectStoreAdmin(object_store_settings),
        source_truth_inventory_store=build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        ),
        file_release_inventory_store=build_authenticated_notice_file_release_inventory_store_from_env(
            source,
            prefer_operator=True,
        ),
    )
    print(
        json.dumps(
            {
                "schema_version": report["schema_version"],
                "output_path": str(output_path),
                "write_performed": report["write_performed"],
                "total_locator_count": report["total_locator_count"],
                "verified_object_count": report["verified_object_count"],
                "missing_object_count": report["missing_object_count"],
                "checksum_mismatch_count": report["checksum_mismatch_count"],
                "size_mismatch_count": report["size_mismatch_count"],
                "incomplete_locator_count": report["incomplete_locator_count"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
