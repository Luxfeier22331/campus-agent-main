from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter, utc_now
from campus_ingestion_core.document_reader_publisher import (
    DocumentReaderPublisherObjectStore,
    publish_document_reader_assets,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NoticeConsumptionProjectionStore,
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
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

_SCHEMA_VERSION = "internal_notice_regulation_document_site_publish.v1"
_INSTITUTIONAL_SCOPE = ("regulations", "institutional_rules")
_SCOPED_RULES_SCOPE = ("regulations", "scoped_rules")
_TARGET_SCOPES = (_INSTITUTIONAL_SCOPE, _SCOPED_RULES_SCOPE)


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationDocumentSitePublishRequest:
    bundle_path: Path
    dry_run_report_path: Path
    output_dir: Path
    site_id: str
    source_home_url: str
    export_manifest_path: Path | None = None
    notice_ids: tuple[str, ...] = ()
    selection_path: Path | None = None
    corpus: str = "campus_notices"
    collection: str = "internal_notice"
    promotion_routing_path: Path | None = None
    notice_family_config_path: Path | None = None
    import_docs_read_model: bool = False
    docs_read_model_import_cwd: Path = Path("apps/app-api")

    def __post_init__(self) -> None:
        object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        object.__setattr__(self, "dry_run_report_path", Path(self.dry_run_report_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        if self.export_manifest_path is not None:
            object.__setattr__(self, "export_manifest_path", Path(self.export_manifest_path))
        if self.selection_path is not None:
            object.__setattr__(self, "selection_path", Path(self.selection_path))
        if self.promotion_routing_path is not None:
            object.__setattr__(self, "promotion_routing_path", Path(self.promotion_routing_path))
        if self.notice_family_config_path is not None:
            object.__setattr__(
                self,
                "notice_family_config_path",
                Path(self.notice_family_config_path),
            )
        object.__setattr__(
            self,
            "notice_ids",
            normalize_notice_ids(self.notice_ids),
        )


def publish_internal_notice_regulation_document_site(
    *,
    request: InternalNoticeRegulationDocumentSitePublishRequest,
    env: Mapping[str, str] | None = None,
    object_store: DocumentReaderPublisherObjectStore | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    consumption_projection_store: NoticeConsumptionProjectionStore | None = None,
) -> dict[str, Any]:
    source = dict(env if env is not None else os.environ)
    request.output_dir.mkdir(parents=True, exist_ok=True)
    dry_run_report = _load_json_object(request.dry_run_report_path)
    selected_notice_ids = _resolve_selected_notice_ids(
        explicit_notice_ids=request.notice_ids,
        selection_path=request.selection_path,
        dry_run_report=dry_run_report,
    )
    _assert_dry_run_report_allows_publish(
        dry_run_report=dry_run_report,
        selected_notice_ids=selected_notice_ids,
    )

    bundle_records = _load_bundle_records(request.bundle_path)
    selected_bundle_records = _select_bundle_records(
        bundle_records=bundle_records,
        selected_notice_ids=selected_notice_ids,
    )
    selected_bundle_path = request.output_dir / "selected-notices-bundle.json"
    _write_json(selected_bundle_path, selected_bundle_records)

    selected_manifest = _build_selected_export_manifest(
        export_manifest_path=request.export_manifest_path,
        selected_notice_ids=selected_notice_ids,
    )
    selected_manifest_path = request.output_dir / "selected-export-manifest.json"
    _write_json(selected_manifest_path, selected_manifest)

    admission_manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
        bundle_records=selected_bundle_records,
        config=_load_notice_family_config(request.notice_family_config_path, source),
        admission_run_id=f"regulation-document-site-import-{utc_now()}",
        selection_source="regulation_document_site_formal_import",
        selection_path=str(selected_bundle_path),
        site_id=request.site_id,
        scope_write_mode="upsert_selected",
    )
    admission_manifest_path = request.output_dir / "consumer-admission-manifest.json"
    write_internal_notice_consumer_admission_manifest(admission_manifest_path, admission_manifest)

    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreWriter(settings)
    runtime_document_registry = document_registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    runtime_inventory_store = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    runtime_projection_store = (
        consumption_projection_store or build_notice_consumption_projection_store_from_env(source)
    )

    source_truth_import_report = import_authenticated_notice_export(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=selected_bundle_path,
            export_manifest_path=selected_manifest_path,
            consumer_admission_manifest_path=admission_manifest_path,
            site_id=request.site_id,
            source_home_url=request.source_home_url,
            corpus=request.corpus,
            collection=request.collection,
            mode="admit_and_materialize",
            replace_scope=False,
        ),
        env=source,
        object_store=runtime_object_store,
        document_registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        source_truth_inventory_store=runtime_inventory_store,
        consumption_projection_store=runtime_projection_store,
    )

    promotion_request = InternalNoticeRegulationPromotionRequest(
        corpus=request.corpus,
        collection=request.collection,
        promotion_routing_path=request.promotion_routing_path,
        notice_ids=selected_notice_ids,
    )
    institutional_report = materialize_institutional_regulations_from_internal_notice_scope(
        request=promotion_request,
        env=source,
        object_store=runtime_object_store,
        registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        source_truth_inventory_store=runtime_inventory_store,
        consumption_projection_store=runtime_projection_store,
    )
    scoped_report = materialize_scoped_rules_from_internal_notice_scope(
        request=promotion_request,
        env=source,
        object_store=runtime_object_store,
        registry=runtime_document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        source_truth_inventory_store=runtime_inventory_store,
        consumption_projection_store=runtime_projection_store,
    )
    materialized_document_count = (
        institutional_report.materialized_document_count + scoped_report.materialized_document_count
    )
    if materialized_document_count == 0:
        raise ValueError("selected notices did not materialize any regulation document")

    materialization_report_path = request.output_dir / "materialization-report.json"
    _write_json(
        materialization_report_path,
        {
            "/".join(_INSTITUTIONAL_SCOPE): asdict(institutional_report),
            "/".join(_SCOPED_RULES_SCOPE): asdict(scoped_report),
        },
    )

    target_records = _select_current_target_records(
        registry=runtime_document_registry,
        scopes=_TARGET_SCOPES,
    )
    reader_report = publish_document_reader_assets(
        bucket_derived=settings.bucket_derived,
        generated_at=utc_now(),
        object_store=runtime_object_store,
        records=target_records,
    )
    docs_read_model_manifest_path = request.output_dir / "docs-read-model-manifest.json"
    _write_json(docs_read_model_manifest_path, reader_report.manifest)

    docs_read_model_import_result = None
    if request.import_docs_read_model:
        docs_read_model_import_result = _run_docs_read_model_import(
            manifest_path=docs_read_model_manifest_path.resolve(),
            cwd=request.docs_read_model_import_cwd,
        )

    report: dict[str, Any] = {
        "schema_version": _SCHEMA_VERSION,
        "mode": "dry_run_then_formal_import",
        "selected_notice_ids": list(selected_notice_ids),
        "selected_bundle_path": str(selected_bundle_path),
        "selected_export_manifest_path": str(selected_manifest_path),
        "consumer_admission_manifest_path": str(admission_manifest_path),
        "source_truth_import": source_truth_import_report,
        "materialization_report_path": str(materialization_report_path),
        "materialized_document_count": materialized_document_count,
        "materialized_document_counts_by_scope": {
            "/".join(_INSTITUTIONAL_SCOPE): institutional_report.materialized_document_count,
            "/".join(_SCOPED_RULES_SCOPE): scoped_report.materialized_document_count,
        },
        "docs_read_model_manifest_path": str(docs_read_model_manifest_path),
        "docs_read_model_import_command": (
            "DOCS_READ_MODEL_MANIFEST_PATH="
            f"{docs_read_model_manifest_path.resolve()} "
            "pnpm --dir apps/app-api docs:import-read-model"
        ),
        "docs_read_model_import_result": docs_read_model_import_result,
        "reader_asset_count": reader_report.asset_count,
        "reader_document_count": reader_report.document_count,
        "gated_entry_count": reader_report.gated_entry_count,
        "public_entry_count": reader_report.public_entry_count,
        "target_scopes": ["/".join(scope) for scope in _TARGET_SCOPES],
        "target_scope_document_count": len(target_records),
        "query_serving_opened": False,
        "rag_release_opened": False,
    }
    report_path = request.output_dir / "publish-report.json"
    report["report_path"] = str(report_path)
    _write_json(report_path, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Publish selected internal_notice regulation candidates after a successful "
            "document-site dry-run."
        )
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--dry-run-report-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-family-config-path")
    parser.add_argument("--import-docs-read-model", action="store_true")
    parser.add_argument("--docs-read-model-import-cwd", default="apps/app-api")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = publish_internal_notice_regulation_document_site(
        request=InternalNoticeRegulationDocumentSitePublishRequest(
            bundle_path=Path(args.bundle_path),
            export_manifest_path=Path(args.manifest_path) if args.manifest_path else None,
            dry_run_report_path=Path(args.dry_run_report_path),
            output_dir=Path(args.output_dir),
            notice_ids=tuple(args.notice_ids),
            selection_path=Path(args.selection_path) if args.selection_path else None,
            site_id=args.site_id,
            source_home_url=args.source_home_url,
            corpus=args.corpus,
            collection=args.collection,
            promotion_routing_path=(
                Path(args.promotion_routing_path) if args.promotion_routing_path else None
            ),
            notice_family_config_path=(
                Path(args.notice_family_config_path) if args.notice_family_config_path else None
            ),
            import_docs_read_model=args.import_docs_read_model,
            docs_read_model_import_cwd=Path(args.docs_read_model_import_cwd),
        )
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _load_notice_family_config(path: Path | None, env: Mapping[str, str]):
    config_path = path or read_authenticated_notice_notice_family_config_path(dict(env))
    return load_authenticated_notice_notice_family_config(config_path)


def _resolve_selected_notice_ids(
    *,
    explicit_notice_ids: Sequence[str],
    selection_path: Path | None,
    dry_run_report: Mapping[str, Any],
) -> tuple[str, ...]:
    selected = list(explicit_notice_ids)
    if selection_path is not None:
        selected.extend(_load_notice_ids_from_selection_path(selection_path))
    if not selected:
        selected.extend(str(item) for item in dry_run_report.get("selected_notice_ids") or ())
    normalized = normalize_notice_ids(selected)
    if not normalized:
        raise ValueError(
            "explicit --notice-id, --selection-path, or dry-run selected notices required"
        )
    return normalized


def _assert_dry_run_report_allows_publish(
    *,
    dry_run_report: Mapping[str, Any],
    selected_notice_ids: Sequence[str],
) -> None:
    report_notice_ids = normalize_notice_ids(
        str(item) for item in dry_run_report.get("selected_notice_ids") or ()
    )
    if set(report_notice_ids) != set(selected_notice_ids):
        raise ValueError(
            "dry-run report selected_notice_ids must match formal import selection: "
            f"dry_run={report_notice_ids}, import={tuple(selected_notice_ids)}"
        )
    if dry_run_report.get("query_serving_opened") is not False:
        raise ValueError("dry-run report must prove query_serving_opened=false")
    if dry_run_report.get("rag_release_opened") is not False:
        raise ValueError("dry-run report must prove rag_release_opened=false")
    for key in (
        "ready_projection_entry_count",
        "materialized_document_count",
        "reader_document_count",
    ):
        if int(dry_run_report.get(key) or 0) <= 0:
            raise ValueError(f"dry-run report must have positive {key}")


def _load_bundle_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("bundle path must contain a JSON array")
    return [dict(item) for item in payload if isinstance(item, Mapping)]


def _select_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    selected_notice_ids: Sequence[str],
) -> list[dict[str, Any]]:
    selected_notice_id_set = set(selected_notice_ids)
    selected_records = [
        dict(record)
        for record in bundle_records
        if _notice_id_from_bundle_record(record) in selected_notice_id_set
    ]
    found_notice_ids = {
        _notice_id_from_bundle_record(record)
        for record in selected_records
        if _notice_id_from_bundle_record(record)
    }
    missing_notice_ids = sorted(selected_notice_id_set - found_notice_ids)
    if missing_notice_ids:
        raise ValueError(
            "selected notice ids missing from source bundle: " + ", ".join(missing_notice_ids)
        )
    return selected_records


def _notice_id_from_bundle_record(record: Mapping[str, Any]) -> str:
    notice_id = str(record.get("notice_id") or "").strip()
    if notice_id:
        return notice_id
    notice = record.get("notice")
    if isinstance(notice, Mapping):
        return str(notice.get("notice_id") or "").strip()
    return ""


def _build_selected_export_manifest(
    *,
    export_manifest_path: Path | None,
    selected_notice_ids: Sequence[str],
) -> dict[str, Any]:
    manifest = _load_json_object(export_manifest_path) if export_manifest_path else {}
    selected_manifest = _strip_full_scope_flags(manifest)
    filters = dict(selected_manifest.get("filters") or {})
    filters["selected_notice_ids"] = list(selected_notice_ids)
    selected_manifest["filters"] = filters
    selected_manifest["source_truth_import"] = {
        "replace_scope": False,
        "scope_write_mode": "upsert_selected",
    }
    return selected_manifest


def _strip_full_scope_flags(payload: Mapping[str, Any]) -> dict[str, Any]:
    stripped = dict(payload)
    for key in (
        "replace_scope",
        "scope_refresh",
        "scope_write_mode",
        "source_truth_scope",
    ):
        stripped.pop(key, None)
    for container_key in ("source_truth_import", "source_truth", "import"):
        container = stripped.get(container_key)
        if isinstance(container, Mapping):
            stripped[container_key] = _strip_full_scope_flags(container)
    return stripped


def _select_current_target_records(
    *,
    registry: DocumentRegistry,
    scopes: Sequence[tuple[str, str]],
) -> tuple[DocumentRegistryRecord, ...]:
    records = [
        record
        for scope in scopes
        for record in registry.list_by_scope(*scope)
        if record.status == "active" and record.is_current
    ]
    return tuple(
        sorted(records, key=lambda record: (record.corpus, record.collection, record.document_id))
    )


def _run_docs_read_model_import(*, manifest_path: Path, cwd: Path) -> dict[str, Any]:
    resolved_manifest_path = manifest_path.resolve()
    completed = subprocess.run(
        ["pnpm", "docs:import-read-model"],
        cwd=cwd,
        check=True,
        env={**os.environ, "DOCS_READ_MODEL_MANIFEST_PATH": str(resolved_manifest_path)},
        capture_output=True,
        text=True,
    )
    stdout = completed.stdout.strip()
    return json.loads(stdout) if stdout.startswith("{") else {"stdout": stdout}


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


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "InternalNoticeRegulationDocumentSitePublishRequest",
    "build_parser",
    "main",
    "publish_internal_notice_regulation_document_site",
]


if __name__ == "__main__":
    main()
