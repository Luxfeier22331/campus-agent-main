from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
import json
from pathlib import Path
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import authenticated notice bootstrap exports")
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--attachment-blob-root")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    entitlement_groups = tuple(str(item).strip() for item in args.entitlement_group if str(item).strip())
    request = AuthenticatedNoticeImportRequest(
        bundle_path=Path(args.bundle_path),
        export_manifest_path=(Path(args.manifest_path) if args.manifest_path else None),
        attachment_blob_root=(Path(args.attachment_blob_root) if args.attachment_blob_root else None),
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        corpus=args.corpus,
        collection=args.collection,
        default_entitlement_groups=(entitlement_groups or ("campus_members",)),
        visibility_scope=args.visibility_scope,
    )
    result = import_authenticated_notice_export(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = ["AuthenticatedNoticeImportRequest", "build_parser", "import_authenticated_notice_export", "main"]


if __name__ == "__main__":
    main()
