from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.document_reader_publisher import publish_document_reader_assets
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_inventory_entries,
)
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    rebuild_internal_notice_consumption_projection,
)
from campus_ingestion_core.internal_notice_regulation_materialization import (
    materialize_institutional_regulations_from_internal_notice_scope,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization import (
    materialize_scoped_rules_from_internal_notice_scope,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
    InMemoryNoticeConsumptionProjectionStore,
    normalize_notice_ids,
)
from campus_ingestion_core.registry import _document_record_from_dict

from campus_ingestion_worker.env_bootstrap import load_worker_env

_SCHEMA_VERSION = "internal_notice_regulation_document_site_dry_run.v1"
_INSTITUTIONAL_SCOPE = ("regulations", "institutional_rules")
_SCOPED_RULES_SCOPE = ("regulations", "scoped_rules")
_TARGET_SCOPES = (_INSTITUTIONAL_SCOPE, _SCOPED_RULES_SCOPE)


class LocalFilesystemObjectStore:
    def __init__(self, source_root: Path, *, write_root: Path | None = None) -> None:
        self.source_root = Path(source_root)
        self.write_root = Path(write_root) if write_root is not None else self.source_root

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        overlay_path = self.write_root / bucket / key
        if overlay_path.exists():
            return overlay_path.read_bytes()
        return (self.source_root / bucket / key).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        target = self.write_root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run selected campus_notices/internal_notice regulation candidates into "
            "local regulations/* storage and document-reader assets."
        )
    )
    parser.add_argument("--documents-json", required=True)
    parser.add_argument("--source-truth-inventory-json", required=True)
    parser.add_argument("--object-store-root", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--document-id", action="append", dest="document_ids", default=[])
    parser.add_argument("--admission-run-id", default="regulation-document-site-dry-run")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-family-config-path")
    parser.add_argument("--bucket-source", default="campus-rag-source")
    parser.add_argument("--bucket-derived", default="campus-rag-derived")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    selected_notice_ids = _resolve_selected_notice_ids(
        notice_ids=args.notice_ids,
        selection_path=args.selection_path,
    )
    if not selected_notice_ids:
        raise ValueError("explicit --notice-id or --selection-path is required for dry-run")

    target_object_store_root = output_dir / "object-store"
    object_store = LocalFilesystemObjectStore(
        Path(args.object_store_root),
        write_root=target_object_store_root,
    )
    registry = InMemoryDocumentRegistry(
        _load_document_records(Path(args.documents_json)),
        backing_path=output_dir / "document-registry.json",
    )
    raw_asset_registry = InMemoryRawAssetRegistry(
        (),
        backing_path=output_dir / "raw-asset-registry.json",
    )
    inventory_entries = _load_inventory_entries(Path(args.source_truth_inventory_json))
    selected_inventory_entries = tuple(
        entry for entry in inventory_entries if entry.notice_id in set(selected_notice_ids)
    )
    missing_notice_ids = tuple(
        sorted(set(selected_notice_ids) - {entry.notice_id for entry in selected_inventory_entries})
    )
    if missing_notice_ids:
        raise ValueError(
            f"selected notice ids missing from source-truth inventory: {missing_notice_ids}"
        )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(selected_inventory_entries)

    manifest = build_internal_notice_consumer_admission_manifest_from_inventory_entries(
        inventory_entries=selected_inventory_entries,
        config=_load_notice_family_config(args.notice_family_config_path),
        admission_run_id=str(args.admission_run_id),
        selection_source="regulation_document_site_dry_run",
        selection_path=args.selection_path or ",".join(selected_notice_ids),
        scope_write_mode="upsert_selected",
    )
    manifest_path = output_dir / "consumer-admission-manifest.json"
    write_internal_notice_consumer_admission_manifest(manifest_path, manifest)

    gate_report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=selected_notice_ids,
            target_surface=NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
        ),
    )
    gate_report_path = output_dir / "consumer-admission-gate-report.json"
    gate_report_path.write_text(
        json.dumps(asdict(gate_report), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if not gate_report.allowed:
        raise SystemExit(1)

    env = _local_object_store_env(
        bucket_source=str(args.bucket_source),
        bucket_derived=str(args.bucket_derived),
    )
    request = InternalNoticeRegulationPromotionRequest(
        corpus="campus_notices",
        collection="internal_notice",
        promotion_routing_path=(
            Path(args.promotion_routing_path) if args.promotion_routing_path else None
        ),
        notice_ids=selected_notice_ids,
        document_ids=tuple(args.document_ids),
    )
    projection_store = InMemoryNoticeConsumptionProjectionStore()
    projection_entries = rebuild_internal_notice_consumption_projection(
        request=request,
        env=env,
        registry=registry,
        source_truth_inventory_store=inventory_store,
        object_store=object_store,
        projection_store=projection_store,
        admission_batch_id=manifest.admission_run_id,
        admission_command="regulation_document_site_dry_run",
        admission_created_at=manifest.created_at,
    )
    projection_path = output_dir / "notice-consumption-projection.jsonl"
    _write_jsonl(projection_path, (asdict(entry) for entry in projection_entries))
    ready_projection_entries = tuple(
        entry
        for entry in projection_entries
        if _is_ready_regulation_projection_entry(entry)
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )

    institutional_report = materialize_institutional_regulations_from_internal_notice_scope(
        request=request,
        env=env,
        object_store=object_store,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
        consumption_projection_store=projection_store,
    )
    scoped_report = materialize_scoped_rules_from_internal_notice_scope(
        request=request,
        env=env,
        object_store=object_store,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
        consumption_projection_store=projection_store,
    )
    materialization_reports = {
        "/".join(_INSTITUTIONAL_SCOPE): asdict(institutional_report),
        "/".join(_SCOPED_RULES_SCOPE): asdict(scoped_report),
    }
    materialization_report_path = output_dir / "materialization-report.json"
    materialization_report_path.write_text(
        json.dumps(
            materialization_reports,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    target_records = tuple(
        record
        for scope in _TARGET_SCOPES
        for record in registry.list_by_scope(*scope)
        if record.status == "active" and record.is_current
    )
    reader_report = publish_document_reader_assets(
        bucket_derived=str(args.bucket_derived),
        generated_at=manifest.created_at,
        object_store=object_store,
        records=target_records,
    )
    reader_manifest_path = output_dir / "document-reader-manifest.json"
    reader_manifest_path.write_text(
        json.dumps(reader_report.manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    reader_report_path = output_dir / "document-reader-report.json"
    reader_report_path.write_text(
        json.dumps(asdict(reader_report), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    report = {
        "schema_version": _SCHEMA_VERSION,
        "selected_notice_ids": list(selected_notice_ids),
        "target_scopes": ["/".join(scope) for scope in _TARGET_SCOPES],
        "consumer_admission_manifest_path": str(manifest_path),
        "gate_report_path": str(gate_report_path),
        "projection_path": str(projection_path),
        "projection_entry_count": len(projection_entries),
        "ready_projection_entry_count": len(ready_projection_entries),
        "materialization_report_path": str(materialization_report_path),
        "materialized_document_count": (
            institutional_report.materialized_document_count
            + scoped_report.materialized_document_count
        ),
        "materialized_document_counts_by_scope": {
            "/".join(_INSTITUTIONAL_SCOPE): institutional_report.materialized_document_count,
            "/".join(_SCOPED_RULES_SCOPE): scoped_report.materialized_document_count,
        },
        "target_document_registry_path": str(registry.backing_path or ""),
        "target_raw_asset_registry_path": str(raw_asset_registry.backing_path or ""),
        "target_object_store_root": str(target_object_store_root),
        "document_reader_manifest_path": str(reader_manifest_path),
        "document_reader_report_path": str(reader_report_path),
        "reader_asset_count": reader_report.asset_count,
        "reader_document_count": reader_report.document_count,
        "gated_entry_count": reader_report.gated_entry_count,
        "public_entry_count": reader_report.public_entry_count,
        "query_serving_opened": False,
        "rag_release_opened": False,
    }
    report_path = output_dir / "dry-run-report.json"
    report["report_path"] = str(report_path)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _load_notice_family_config(path: str | None):
    config_path = Path(path) if path else read_authenticated_notice_notice_family_config_path({})
    return load_authenticated_notice_notice_family_config(config_path)


def _is_ready_regulation_projection_entry(entry: Any) -> bool:
    if (
        entry.target_surface == NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES
        and entry.primary_role == NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY
    ):
        return True
    return entry.target_surface == NOTICE_TARGET_SURFACE_SCOPED_RULES and entry.primary_role in {
        NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
        NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    }


def _load_document_records(path: Path) -> tuple[DocumentRegistryRecord, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.values() if isinstance(payload, dict) else payload
    return tuple(_document_record_from_dict(dict(row)) for row in rows if isinstance(row, Mapping))


def _load_inventory_entries(path: Path) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if not stripped:
        return ()
    if stripped.startswith("["):
        rows = json.loads(stripped)
    elif stripped.startswith("{"):
        payload = json.loads(stripped)
        rows = payload.values() if isinstance(payload, dict) else ()
    else:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    return tuple(
        AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
        for row in rows
        if isinstance(row, Mapping)
    )


def _resolve_selected_notice_ids(
    *,
    notice_ids: Sequence[str],
    selection_path: str | None,
) -> tuple[str, ...]:
    selected = list(notice_ids)
    if selection_path:
        selected.extend(_load_notice_ids_from_selection_path(Path(selection_path)))
    return normalize_notice_ids(selected)


def _load_notice_ids_from_selection_path(path: Path) -> tuple[str, ...]:
    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if not stripped:
        return ()
    if stripped.startswith("["):
        rows = json.loads(stripped)
    elif stripped.startswith("{"):
        payload = json.loads(stripped)
        rows = payload.get("notice_ids") or payload.get("selected_notice_ids") or payload.values()
    else:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    notice_ids: list[str] = []
    for row in rows:
        if isinstance(row, str):
            notice_ids.append(row)
        elif isinstance(row, Mapping):
            notice_ids.append(str(row.get("notice_id") or row.get("source_notice_id") or ""))
    return tuple(notice_ids)


def _local_object_store_env(*, bucket_source: str, bucket_derived: str) -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "local-dry-run",
        "OBJECT_STORE_SECRET_KEY": "local-dry-run",
        "OBJECT_STORE_BUCKET_SOURCE": bucket_source,
        "OBJECT_STORE_BUCKET_DERIVED": bucket_derived,
        "EMBEDDING_PROVIDER": "mock",
        "EMBEDDING_MODEL": "mock-embedding-8d",
        "SPARSE_PROVIDER": "mock",
    }


def _write_jsonl(path: Path, rows: Sequence[dict[str, Any]] | Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")


__all__ = [
    "LocalFilesystemObjectStore",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
