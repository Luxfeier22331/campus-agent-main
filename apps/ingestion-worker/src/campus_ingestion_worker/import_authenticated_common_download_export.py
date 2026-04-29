from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_common_download_import import (
    AuthenticatedCommonDownloadImportRequest,
    import_authenticated_common_download_export,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import authenticated common-download notice exports"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument("--attachment-blob-root")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument(
        "--mode",
        default="plan",
        choices=("plan", "dry-run", "dry_run", "admit-and-materialize", "admit_and_materialize"),
        help=(
            "Import admission mode. Defaults to plan/dry-run; use admit-and-materialize "
            "to write source artifacts, registries, and common-download holding rows."
        ),
    )
    parser.add_argument(
        "--replace-scope",
        action="store_true",
        help="Allow this import to refresh the entire authenticated_documents/common_download_source scope.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    entitlement_groups = tuple(
        str(item).strip() for item in args.entitlement_group if str(item).strip()
    )
    request = AuthenticatedCommonDownloadImportRequest(
        bundle_path=Path(args.bundle_path),
        manifest_path=Path(args.manifest_path),
        attachment_blob_root=(
            Path(args.attachment_blob_root) if args.attachment_blob_root else None
        ),
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        default_entitlement_groups=(entitlement_groups or ("campus_members",)),
        visibility_scope=args.visibility_scope,
        mode=args.mode,
        replace_scope=args.replace_scope,
    )
    result = import_authenticated_common_download_export(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "AuthenticatedCommonDownloadImportRequest",
    "build_parser",
    "import_authenticated_common_download_export",
    "main",
]


if __name__ == "__main__":
    main()
