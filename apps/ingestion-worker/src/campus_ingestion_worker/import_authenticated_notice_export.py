from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import authenticated notice bootstrap exports")
    parser.add_argument("--run-id")
    parser.add_argument("--source-bucket")
    parser.add_argument("--bundle-object-key")
    parser.add_argument("--manifest-object-key")
    parser.add_argument("--bundle-content-sha256")
    parser.add_argument("--bundle-byte-size", type=int)
    parser.add_argument("--manifest-content-sha256")
    parser.add_argument("--manifest-byte-size", type=int)
    parser.add_argument("--collector-run-ledger-table")
    parser.add_argument("--bundle-path")
    parser.add_argument("--manifest-path")
    parser.add_argument(
        "--allow-local-fixture-import",
        action="store_true",
        help="Allow dev/test import from local bundle/manifest paths.",
    )
    parser.add_argument("--consumer-admission-manifest-path")
    parser.add_argument("--attachment-blob-root")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument(
        "--mode",
        default="plan",
        choices=("plan", "dry-run", "dry_run", "admit-and-materialize", "admit_and_materialize"),
        help=(
            "Import admission mode. Defaults to plan/dry-run; use admit-and-materialize "
            "to write source artifacts, registries, projections, and read models."
        ),
    )
    parser.add_argument(
        "--replace-scope",
        action="store_true",
        help="Allow this import to refresh the entire source corpus/collection scope.",
    )
    parser.add_argument(
        "--source-truth-only",
        action="store_true",
        help="Stop after source-truth/document holding materialization and skip downstream notice consumption.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    entitlement_groups = tuple(
        str(item).strip() for item in args.entitlement_group if str(item).strip()
    )
    request = AuthenticatedNoticeImportRequest(
        run_id=args.run_id,
        source_bucket=args.source_bucket,
        bundle_object_key=args.bundle_object_key,
        manifest_object_key=args.manifest_object_key,
        bundle_content_sha256=args.bundle_content_sha256,
        bundle_byte_size=args.bundle_byte_size,
        manifest_content_sha256=args.manifest_content_sha256,
        manifest_byte_size=args.manifest_byte_size,
        collector_run_ledger_table=args.collector_run_ledger_table,
        bundle_path=(Path(args.bundle_path) if args.bundle_path else None),
        export_manifest_path=(Path(args.manifest_path) if args.manifest_path else None),
        allow_local_fixture_import=args.allow_local_fixture_import,
        consumer_admission_manifest_path=(
            Path(args.consumer_admission_manifest_path)
            if args.consumer_admission_manifest_path
            else None
        ),
        attachment_blob_root=(
            Path(args.attachment_blob_root) if args.attachment_blob_root else None
        ),
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        corpus=args.corpus,
        collection=args.collection,
        default_entitlement_groups=(entitlement_groups or ("campus_members",)),
        visibility_scope=args.visibility_scope,
        mode=args.mode,
        replace_scope=args.replace_scope,
        source_truth_only=args.source_truth_only,
    )
    result = import_authenticated_notice_export(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "AuthenticatedNoticeImportRequest",
    "build_parser",
    "import_authenticated_notice_export",
    "main",
]


if __name__ == "__main__":
    main()
