from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.smoke_authenticated_notice_bootstrap import (
    build_smoke_summary,
)


class LocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.uploads: list[dict[str, Any]] = []

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        target = self.root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "path": str(target),
                "content_type": content_type,
                "metadata": dict(metadata or {}),
                "content_length": len(data),
            }
        )

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run authenticated notice bootstrap import smoke checks against local filesystem artifacts only."
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--attachment-blob-root")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument("--expect-notice-count", type=int)
    parser.add_argument("--local-output-dir", required=True)
    parser.add_argument("--summary-output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    entitlement_groups = tuple(
        str(item).strip() for item in args.entitlement_group if str(item).strip()
    )
    request = AuthenticatedNoticeImportRequest(
        bundle_path=Path(args.bundle_path),
        export_manifest_path=(Path(args.manifest_path) if args.manifest_path else None),
        attachment_blob_root=(
            Path(args.attachment_blob_root) if args.attachment_blob_root else None
        ),
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        corpus=args.corpus,
        collection=args.collection,
        default_entitlement_groups=(entitlement_groups or ("campus_members",)),
        visibility_scope=args.visibility_scope,
        mode="admit_and_materialize",
    )
    output_root = Path(args.local_output_dir)
    object_store = LocalFilesystemObjectStore(output_root / "object-store")
    document_registry = InMemoryDocumentRegistry(
        backing_path=output_root / "registry" / "documents.json"
    )
    raw_asset_registry = InMemoryRawAssetRegistry(
        backing_path=output_root / "registry" / "raw-assets.json"
    )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    result = import_authenticated_notice_export(
        request=request,
        env={
            "OBJECT_STORE_ENDPOINT": "http://local-smoke.invalid",
            "OBJECT_STORE_ACCESS_KEY": "local-smoke",
            "OBJECT_STORE_SECRET_KEY": "local-smoke",
        },
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )
    inventory_entries = inventory_store.list_by_scope(request.corpus, request.collection)
    inventory_path = output_root / "registry" / "source-truth-inventory.json"
    uploads_path = output_root / "object-store" / "uploads.json"
    inventory_path.parent.mkdir(parents=True, exist_ok=True)
    inventory_path.write_text(
        f"{json.dumps([asdict(item) for item in inventory_entries], ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    uploads_path.write_text(
        f"{json.dumps(object_store.uploads, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    summary = build_smoke_summary(
        result=result,
        expected_notice_count=args.expect_notice_count,
        execution={
            "bundle_path": str(request.bundle_path),
            "manifest_path": (
                str(request.export_manifest_path)
                if request.export_manifest_path is not None
                else None
            ),
            "attachment_blob_root": (
                str(request.attachment_blob_root)
                if request.attachment_blob_root is not None
                else None
            ),
            "site_id": request.site_id,
            "source_home_url": request.source_home_url,
            "corpus": request.corpus,
            "collection": request.collection,
            "entitlement_groups": list(request.default_entitlement_groups),
            "visibility_scope": request.visibility_scope,
            "local_output_dir": str(output_root),
            "document_registry_path": str(document_registry.backing_path),
            "raw_asset_registry_path": str(raw_asset_registry.backing_path),
            "source_truth_inventory_path": str(inventory_path),
            "object_uploads_path": str(uploads_path),
        },
    )
    if args.summary_output_path:
        summary_path = Path(args.summary_output_path)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(
            f"{json.dumps(summary, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not summary["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
