from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    _load_jsonl_rows,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
    rebuild_authenticated_notice_source_projections,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    _content_type_for_artifact,
    _materialize_document_import_for_persistence,
    load_authenticated_notice_bundle_payload,
    prepare_authenticated_notice_bundle_records,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
    build_authenticated_notice_source_truth_parent_snapshot_from_payloads,
    inventory_entry_from_parent_snapshot,
)
from campus_ingestion_core.campusrag_ingestion_support import collect_import_document_stats
from campus_ingestion_core.internal_notice_regulation_materialization import (
    materialize_institutional_regulations_from_internal_notice_scope,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.registry import (
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_worker.env_bootstrap import load_worker_env


TARGET_NOTICE_ID = "355282"
REPO_ROOT = Path(__file__).resolve().parents[3]
QUICK_DIR = REPO_ROOT / ".planning" / "quick" / "260414-bsz-regulation-355282-formal-local-target"
OUTPUT_DIR = QUICK_DIR / "run-output"
OFFLINE_INVENTORY_PATH = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260414-ang-regulation-corpus-inventory-blocked-fron"
    / "regulation-offline-inventory.json"
)
FILTERED_BUNDLE_PATH = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260414-regulation-owner-recovery-pilot"
    / "run-output-fixed"
    / "filtered-notices-bundle.json"
)
FILTERED_OBJECT_STORE_ROOT = (
    REPO_ROOT
    / ".planning"
    / "quick"
    / "260414-regulation-owner-recovery-pilot"
    / "run-output-fixed"
    / "object-store"
)


def _normalize(value: Any) -> Any:
    if is_dataclass(value):
        return {key: _normalize(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    return value


def _load_formal_notice_ids() -> tuple[str, ...]:
    payload = json.loads(OFFLINE_INVENTORY_PATH.read_text(encoding="utf-8"))
    notice_ids = [
        str(entry["notice_id"])
        for entry in payload.get("entries") or []
        if str(entry.get("status") or "") == "accepted_current_target"
    ]
    notice_ids.append(TARGET_NOTICE_ID)
    return tuple(sorted(dict.fromkeys(notice_ids)))


def _load_first_document_units_metadata(
    *,
    object_store: S3ObjectStoreWriter,
    object_store_settings: ObjectStoreSettings,
    object_key: str | None,
) -> dict[str, Any]:
    if not object_key:
        return {}
    rows = (
        object_store.get_bytes(
            bucket=object_store_settings.bucket_derived,
            key=object_key,
        )
        .decode("utf-8")
        .splitlines()
    )
    if not rows:
        return {}
    return dict(json.loads(rows[0]).get("metadata") or {})


def _load_target_snapshot(
    *,
    object_store: S3ObjectStoreWriter,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str],
) -> list[dict[str, Any]]:
    registry = build_document_registry_from_env(env)
    snapshot: list[dict[str, Any]] = []
    for record in registry.list_by_scope("regulations", "institutional_regulations"):
        metadata = _load_first_document_units_metadata(
            object_store=object_store,
            object_store_settings=object_store_settings,
            object_key=record.document_units_object_key,
        )
        snapshot.append(
            {
                "document_id": record.document_id,
                "version_id": record.version_id,
                "title": metadata.get("title"),
                "source_notice_ids": metadata.get("source_notice_ids"),
                "source_document_ids": metadata.get("source_document_ids"),
                "regulation_display_title": metadata.get("regulation_display_title"),
                "regulation_work_title": metadata.get("regulation_work_title"),
                "regulation_edition_label": metadata.get("regulation_edition_label"),
            }
        )
    return sorted(snapshot, key=lambda item: str(item["document_id"]))


def _load_source_rows(env: dict[str, str]) -> list[str]:
    registry = build_document_registry_from_env(env)
    return sorted(
        record.document_id
        for record in registry.list_by_scope("campus_notices", "internal_notice")
        if TARGET_NOTICE_ID in record.document_id
    )


def _load_current_attachment_refs(
    *,
    env: dict[str, str],
    object_store: S3ObjectStoreWriter,
    object_store_settings: ObjectStoreSettings,
) -> tuple[dict[str, Any], ...]:
    registry = build_document_registry_from_env(env)
    record = next(
        (
            item
            for item in registry.list_by_scope("campus_notices", "internal_notice")
            if item.document_id == f"notice:muc_internal_portal:{TARGET_NOTICE_ID}"
        ),
        None,
    )
    if record is None:
        return ()
    attachment_refs_key = next(
        (key for key in record.processed_object_keys if key.endswith("source-truth/attachment-refs.jsonl")),
        None,
    )
    if not attachment_refs_key:
        return ()
    return tuple(
        _load_jsonl_rows(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=attachment_refs_key,
            )
        )
    )


def _repair_source_truth_if_needed(
    *,
    env: dict[str, str],
    object_store: S3ObjectStoreWriter,
    object_store_settings: ObjectStoreSettings,
) -> dict[str, Any]:
    current_attachment_refs = _load_current_attachment_refs(
        env=env,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    if current_attachment_refs:
        return {
            "status": "skipped_existing_attachment_refs",
            "attachment_ref_count": len(current_attachment_refs),
        }

    request = AuthenticatedNoticeImportRequest(
        bundle_path=FILTERED_BUNDLE_PATH,
        export_manifest_path=None,
        site_id="muc_internal_portal",
        source_home_url="https://my.muc.edu.cn",
        corpus="campus_notices",
        collection="internal_notice",
        default_entitlement_groups=("campus_members",),
        visibility_scope="campus",
    )
    prepared_bundle = prepare_authenticated_notice_bundle_records(
        request=request,
        bundle_records=load_authenticated_notice_bundle_payload(FILTERED_BUNDLE_PATH),
    )
    if prepared_bundle.notice_count != 1:
        raise SystemExit(f"expected a single filtered notice bundle, got {prepared_bundle.notice_count}")
    prepared_import = prepared_bundle.notice_imports[0]

    raw_asset_registry = build_raw_asset_registry_from_env(env)
    raw_asset_registry.upsert(prepared_import.raw_record)

    for artifact_path, payload in (
        list(prepared_import.capture_artifacts.items())
        + list(prepared_import.provider_artifacts.items())
        + list(prepared_import.source_truth_artifacts.items())
    ):
        object_store.put_bytes(
            bucket=object_store_settings.bucket_source,
            key=prepared_import.source_artifact_keys[artifact_path],
            data=payload,
            content_type=_content_type_for_artifact(artifact_path),
        )

    bundle_record = load_authenticated_notice_bundle_payload(FILTERED_BUNDLE_PATH)[0]
    attachment_by_id = {
        str(item.get("attachment_id")): item
        for item in bundle_record.get("attachments") or []
        if isinstance(item, dict) and item.get("attachment_id") is not None
    }
    for relation in bundle_record.get("notice_attachments") or []:
        if not isinstance(relation, dict):
            continue
        attachment = attachment_by_id.get(str(relation.get("attachment_id")))
        if not isinstance(attachment, dict):
            continue
        object_key = str(attachment.get("object_key") or "").strip()
        if not object_key:
            continue
        local_path = FILTERED_OBJECT_STORE_ROOT / object_store_settings.bucket_source / object_key
        if not local_path.is_file():
            raise SystemExit(f"missing local attachment object for repair: {local_path}")
        object_store.put_bytes(
            bucket=object_store_settings.bucket_source,
            key=object_key,
            data=local_path.read_bytes(),
            content_type=str(attachment.get("mime_type") or "application/octet-stream"),
        )

    translated_document = _materialize_document_import_for_persistence(
        prepared_import.document_import,
        prepared_import.source_artifact_keys,
    )
    registry = build_document_registry_from_env(env)
    registry.delete_document(str(translated_document.metadata["document_id"]))
    stats = collect_import_document_stats(
        documents=[translated_document],
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=object_store,
        object_store=object_store_settings,
        parser_version=request.parser_version,
        embedding_model=request.embedding_model,
        cleaning_policy_version=load_runtime_profile(request.corpus, request.collection).cleaning_policy_version,
        default_visibility_scope=request.visibility_scope,
        scope_refresh=None,
    )

    inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(env)
    config_path = read_authenticated_notice_source_projections_config_path(env)
    config = load_authenticated_notice_source_projections_config(config_path)
    parent_record = registry.get(
        str(translated_document.metadata["document_id"]),
        translated_document.revision_track,
        str(translated_document.metadata["version_id"]),
    )
    if parent_record is None:
        raise SystemExit("355282 source repair failed to persist repaired parent row")
    parent_snapshot = build_authenticated_notice_source_truth_parent_snapshot_from_payloads(
        record=parent_record,
        raw_record=prepared_import.raw_record,
        notice_manifest_key=prepared_import.source_artifact_keys["source-truth/notice-manifest.json"],
        content_blocks_key=prepared_import.source_artifact_keys["source-truth/content-blocks.jsonl"],
        attachment_refs_key=prepared_import.source_artifact_keys["source-truth/attachment-refs.jsonl"],
        source_artifact_keys=tuple(
            key
            for key in prepared_import.source_artifact_keys.values()
            if key
        ),
        notice_manifest=json.loads(
            prepared_import.source_truth_artifacts["source-truth/notice-manifest.json"].decode("utf-8")
        ),
        attachment_refs=_load_jsonl_rows(
            prepared_import.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
        ),
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    inventory_store.upsert_many((inventory_entry_from_parent_snapshot(parent_snapshot),))
    return {
        "status": "repaired_from_filtered_bundle",
        "attachment_ref_count": len(
            _load_jsonl_rows(prepared_import.source_truth_artifacts["source-truth/attachment-refs.jsonl"])
        ),
        "created_document_ids": list(stats.created_document_ids),
        "updated_document_ids": list(stats.updated_document_ids),
        "skipped_document_ids": list(stats.skipped_document_ids),
        "errors": list(stats.errors),
    }


def main() -> None:
    load_worker_env()
    env = dict(__import__("os").environ)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    object_store_settings = ObjectStoreSettings.from_env(env)
    object_store = S3ObjectStoreWriter(object_store_settings)
    registry = build_document_registry_from_env(env)
    raw_asset_registry = build_raw_asset_registry_from_env(env)

    before_snapshot = _load_target_snapshot(
        object_store=object_store,
        object_store_settings=object_store_settings,
        env=env,
    )
    source_repair = _repair_source_truth_if_needed(
        env=env,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    projection_report = rebuild_authenticated_notice_source_projections(
        request=AuthenticatedNoticeSourceProjectionRequest(
            corpus="campus_notices",
            collection="internal_notice",
            notice_ids=(TARGET_NOTICE_ID,),
        ),
        env=env,
        document_registry=registry,
        raw_asset_registry=raw_asset_registry,
    )
    source_rows_after_projection = _load_source_rows(env)

    formal_notice_ids = _load_formal_notice_ids()
    manifest_report = build_internal_notice_regulation_promotion_manifest(
        request=InternalNoticeRegulationPromotionRequest(
            corpus="campus_notices",
            collection="internal_notice",
            notice_ids=formal_notice_ids,
        ),
        env=env,
        registry=registry,
    )
    target_notice_report = next(
        (
            report
            for report in manifest_report.documents
            if report.notice_id == TARGET_NOTICE_ID and report.action == "promote_candidate"
        ),
        None,
    )
    if target_notice_report is None:
        raise SystemExit("355282 was not promoted after targeted source projection rebuild")

    materialization_report = materialize_institutional_regulations_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(
            corpus="campus_notices",
            collection="internal_notice",
            notice_ids=formal_notice_ids,
        ),
        env=env,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
    )
    after_snapshot = _load_target_snapshot(
        object_store=object_store,
        object_store_settings=object_store_settings,
        env=env,
    )
    ai_target = next(
        (
            row
            for row in after_snapshot
            if row.get("title") == "中央民族大学关于学生使用人工智能的指导意见 / 2026版"
        ),
        None,
    )
    if ai_target is None:
        raise SystemExit("formal local target does not include 355282 AI guidance document")

    payload = {
        "schema_version": "regulation_355282_formal_local_target_v1",
        "writes_embeddings": False,
        "writes_qdrant": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "formal_notice_ids": list(formal_notice_ids),
        "before_target_count": len(before_snapshot),
        "after_target_count": len(after_snapshot),
        "source_repair": source_repair,
        "source_rows_after_projection": source_rows_after_projection,
        "projection_report": _normalize(projection_report),
        "manifest_report": _normalize(manifest_report),
        "target_notice_report": _normalize(target_notice_report),
        "materialization_report": _normalize(materialization_report),
        "ai_target": ai_target,
    }

    if len(formal_notice_ids) != 11:
        raise SystemExit(f"expected 11 formal notice ids, got {len(formal_notice_ids)}")
    if len(source_rows_after_projection) < 2:
        raise SystemExit("355282 source scope still lacks attachment child after targeted rebuild")
    if manifest_report.candidate_count != 11:
        raise SystemExit(f"expected 11 promotion candidates, got {manifest_report.candidate_count}")
    if manifest_report.manual_review_count != 0:
        raise SystemExit(f"expected 0 manual-review rows, got {manifest_report.manual_review_count}")
    if materialization_report.materialized_document_count != 11:
        raise SystemExit(
            f"expected 11 materialized regulation documents, got {materialization_report.materialized_document_count}"
        )
    if len(after_snapshot) != 11:
        raise SystemExit(f"expected 11 local regulation target rows, got {len(after_snapshot)}")

    (OUTPUT_DIR / "formalization-summary.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
