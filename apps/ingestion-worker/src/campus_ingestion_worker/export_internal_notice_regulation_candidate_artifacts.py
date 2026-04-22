from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_candidate_artifact_manifest,
    export_internal_notice_regulation_candidate_artifacts,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


class ReadonlyLocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export local-only regulation candidate artifacts from campus_notices/internal_notice"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--document-id", action="append", dest="document_ids", default=[])
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--documents-json")
    parser.add_argument("--source-truth-inventory-json")
    parser.add_argument("--object-store-root")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request = InternalNoticeRegulationPromotionRequest(
        corpus=args.corpus,
        collection=args.collection,
        promotion_routing_path=(
            Path(args.promotion_routing_path) if args.promotion_routing_path else None
        ),
        notice_ids=tuple(args.notice_ids),
        document_ids=tuple(args.document_ids),
    )
    local_runtime = _build_local_snapshot_runtime(
        documents_json=args.documents_json,
        source_truth_inventory_json=args.source_truth_inventory_json,
        object_store_root=args.object_store_root,
    )
    manifest, documents = build_internal_notice_regulation_candidate_artifact_manifest(
        request=request,
        **local_runtime,
    )
    manifest_path, candidate_documents_path = export_internal_notice_regulation_candidate_artifacts(
        output_dir=Path(args.output_dir),
        manifest=manifest,
        documents=documents,
    )
    print(
        json.dumps(
            {
                "schema_version": manifest.schema_version,
                "exported_candidate_count": manifest.exported_candidate_count,
                "source_manifest_candidate_count": manifest.source_manifest_candidate_count,
                "manifest_path": str(manifest_path),
                "candidate_documents_path": str(candidate_documents_path),
                "candidate_markdown_paths": [
                    str(Path(args.output_dir) / document.artifact_markdown_path)
                    for document in documents
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def _build_local_snapshot_runtime(
    *,
    documents_json: str | None,
    source_truth_inventory_json: str | None,
    object_store_root: str | None,
) -> dict[str, object]:
    provided = [
        value is not None
        for value in (documents_json, source_truth_inventory_json, object_store_root)
    ]
    if not any(provided):
        return {}
    if not all(provided):
        raise ValueError(
            "--documents-json, --source-truth-inventory-json, and --object-store-root must be provided together"
        )
    registry = InMemoryDocumentRegistry.from_json_file(Path(documents_json))
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_payload = json.loads(Path(source_truth_inventory_json).read_text(encoding="utf-8"))
    rows = inventory_payload.values() if isinstance(inventory_payload, dict) else inventory_payload
    inventory_store.upsert_many(
        tuple(AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row)) for row in rows)
    )
    object_store = ReadonlyLocalFilesystemObjectStore(Path(object_store_root))
    return {
        "registry": registry,
        "source_truth_inventory_store": inventory_store,
        "object_store": object_store,
    }


__all__ = [
    "InternalNoticeRegulationPromotionRequest",
    "ReadonlyLocalFilesystemObjectStore",
    "build_internal_notice_regulation_candidate_artifact_manifest",
    "build_parser",
    "export_internal_notice_regulation_candidate_artifacts",
    "main",
]


if __name__ == "__main__":
    main()
