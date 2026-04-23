from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization import (
    InternalNoticeScopedRuleMaterializationReport,
    materialize_scoped_rules_from_internal_notice_scope,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


class LocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        target = self.root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Materialize regulations/scoped_rules from "
            "campus_notices/internal_notice scoped-rule adjudications"
        )
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--document-id", action="append", dest="document_ids", default=[])
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
    runtime_kwargs = _build_local_snapshot_runtime(
        documents_json=args.documents_json,
        source_truth_inventory_json=args.source_truth_inventory_json,
        object_store_root=args.object_store_root,
    )
    report = materialize_scoped_rules_from_internal_notice_scope(
        request=request,
        **runtime_kwargs,
    )
    payload = (
        asdict(report)
        if isinstance(report, InternalNoticeScopedRuleMaterializationReport)
        else _normalize_payload(report)
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return dict(result)
    raise TypeError("worker result must be a dataclass or dict")


def _build_local_snapshot_runtime(
    *,
    documents_json: str | None,
    source_truth_inventory_json: str | None,
    object_store_root: str | None,
) -> dict[str, Any]:
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
    raw_asset_registry = InMemoryRawAssetRegistry(())
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_payload = json.loads(Path(source_truth_inventory_json).read_text(encoding="utf-8"))
    rows = inventory_payload.values() if isinstance(inventory_payload, dict) else inventory_payload
    inventory_store.upsert_many(
        tuple(AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row)) for row in rows)
    )
    object_store = LocalFilesystemObjectStore(Path(object_store_root))
    return {
        "registry": registry,
        "raw_asset_registry": raw_asset_registry,
        "source_truth_inventory_store": inventory_store,
        "object_store": object_store,
    }


__all__ = [
    "InternalNoticeRegulationPromotionRequest",
    "InternalNoticeScopedRuleMaterializationReport",
    "LocalFilesystemObjectStore",
    "build_parser",
    "main",
    "materialize_scoped_rules_from_internal_notice_scope",
]


if __name__ == "__main__":
    main()
