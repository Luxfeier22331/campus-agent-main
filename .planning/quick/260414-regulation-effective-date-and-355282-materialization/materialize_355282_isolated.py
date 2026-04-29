from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    rebuild_authenticated_notice_source_projections,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_regulation_materialization import (
    materialize_institutional_regulations_from_internal_notice_scope,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)


class LocalDirObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        del content_type
        path = self.root / bucket / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def _normalize(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    return value


def main() -> None:
    base_dir = Path(
        ".planning/quick/260414-regulation-effective-date-and-355282-materialization/run-output"
    ).resolve()
    source_root = Path(
        ".planning/quick/260414-regulation-owner-recovery-pilot/run-output-fixed"
    ).resolve()
    filtered_bundle_path = source_root / "filtered-notices-bundle.json"
    base_dir.mkdir(parents=True, exist_ok=True)

    object_store_root = base_dir / "object-store"
    object_store = LocalDirObjectStore(object_store_root)

    for source_path in (source_root / "object-store").rglob("*"):
        if not source_path.is_file():
            continue
        target_path = object_store_root / source_path.relative_to(source_root / "object-store")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(source_path.read_bytes())

    document_registry = InMemoryDocumentRegistry(base_dir / "registry" / "documents.json")
    raw_asset_registry = InMemoryRawAssetRegistry(base_dir / "registry" / "raw-assets.json")
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()

    env = {
        "OBJECT_STORE_ENDPOINT": "http://example.invalid",
        "OBJECT_STORE_ACCESS_KEY": "dummy",
        "OBJECT_STORE_SECRET_KEY": "dummy",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
    }

    import_result = import_authenticated_notice_export(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=filtered_bundle_path,
            export_manifest_path=None,
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            corpus="campus_notices",
            collection="internal_notice",
            default_entitlement_groups=("campus_members",),
            visibility_scope="campus",
        ),
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )
    projection_report = rebuild_authenticated_notice_source_projections(
        request=AuthenticatedNoticeSourceProjectionRequest(
            corpus="campus_notices",
            collection="internal_notice",
        ),
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
    )

    report = materialize_institutional_regulations_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(notice_ids=("355282",)),
        env=env,
        object_store=object_store,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
    )

    target_documents = [
        _normalize(record)
        for record in document_registry.list_by_scope("regulations", "institutional_regulations")
    ]
    target_raw_assets = [
        _normalize(record)
        for record in raw_asset_registry.list_by_scope("regulations", "institutional_regulations")
    ]
    summary = {
        "import_result": _normalize(import_result),
        "projection_report": _normalize(projection_report),
        "materialization_report": _normalize(report),
        "target_document_count": len(target_documents),
        "target_documents": target_documents,
        "raw_asset_count": len(target_raw_assets),
    }
    (base_dir / "materialization-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
