from __future__ import annotations

from importlib import import_module
from typing import Any

_EXPORTS: dict[str, tuple[str, str]] = {
    "AuthenticatedNoticeImportRequest": (
        "campus_ingestion_worker.import_authenticated_notice_export",
        "AuthenticatedNoticeImportRequest",
    ),
    "AuthenticatedNoticeSourceProjectionRequest": (
        "campus_ingestion_worker.rebuild_authenticated_notice_source_projections",
        "AuthenticatedNoticeSourceProjectionRequest",
    ),
    "AuthenticatedNoticeSourceTruthReplayRequest": (
        "campus_ingestion_core.authenticated_notice_closeout",
        "AuthenticatedNoticeSourceTruthReplayRequest",
    ),
    "ImportReport": ("campus_ingestion_worker.process_raw_ingestion_job", "ImportReport"),
    "LegacyOfficeNormalizationResult": (
        "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment",
        "LegacyOfficeNormalizationResult",
    ),
    "LocalDataRebuildReport": (
        "campus_ingestion_worker.rebuild_local_data",
        "LocalDataRebuildReport",
    ),
    "OfficialWebHandoffConsumeBatchReport": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "OfficialWebHandoffConsumeBatchReport",
    ),
    "OfficialWebHandoffConsumeError": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "OfficialWebHandoffConsumeError",
    ),
    "OfficialWebHandoffConsumeResult": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "OfficialWebHandoffConsumeResult",
    ),
    "OfficialWebHandoffConsumerSettings": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "OfficialWebHandoffConsumerSettings",
    ),
    "OfficialWebHandoffReceiverSettings": (
        "campus_ingestion_worker.official_web_handoff_receiver",
        "OfficialWebHandoffReceiverSettings",
    ),
    "OfficialWebHandoffServerSettings": (
        "campus_ingestion_worker.official_web_handoff_receiver",
        "OfficialWebHandoffServerSettings",
    ),
    "OfficialWebHistoricalBackfillResult": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "OfficialWebHistoricalBackfillResult",
    ),
    "OfficialWebHistoricalBackfillSettings": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "OfficialWebHistoricalBackfillSettings",
    ),
    "OfficialWebHistoricalInventoryResult": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "OfficialWebHistoricalInventoryResult",
    ),
    "OnlineOcrClient": ("campus_ingestion_worker.process_raw_ingestion_job", "OnlineOcrClient"),
    "OnlineOcrProviderResult": (
        "campus_ingestion_worker.process_raw_ingestion_job",
        "OnlineOcrProviderResult",
    ),
    "RawAssetRegistrationResult": (
        "campus_ingestion_worker.register_raw_asset",
        "RawAssetRegistrationResult",
    ),
    "StudentHandbookChunkingValidationReport": (
        "campus_ingestion_worker.validate_student_handbook_chunking",
        "StudentHandbookChunkingValidationReport",
    ),
    "StudentHandbookMigrationReport": (
        "campus_ingestion_worker.migrate_student_handbook_source_faithful",
        "StudentHandbookMigrationReport",
    ),
    "StudentHandbookSourceAssetRequest": (
        "campus_ingestion_worker.migrate_student_handbook_source_faithful",
        "StudentHandbookSourceAssetRequest",
    ),
    "audit_official_web_projection_chunking": (
        "campus_ingestion_worker.audit_official_web_projection_chunking",
        "audit_official_web_projection_chunking",
    ),
    "audit_official_web_projection_chunking_main": (
        "campus_ingestion_worker.audit_official_web_projection_chunking",
        "main",
    ),
    "backfill_historical_handoff_record": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "backfill_historical_handoff_record",
    ),
    "build_authenticated_notice_attachment_fetch_request_manifest_main": (
        "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest",
        "main",
    ),
    "collection_rename_registry_backfill_main": (
        "campus_ingestion_worker.collection_rename_registry_backfill",
        "main",
    ),
    "consume_handoff_record": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "consume_handoff_record",
    ),
    "consume_official_web_handoffs": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "consume_official_web_handoffs",
    ),
    "create_official_web_handoff_app": (
        "campus_ingestion_worker.official_web_handoff_receiver",
        "create_app",
    ),
    "import_authenticated_notice_export": (
        "campus_ingestion_worker.import_authenticated_notice_export",
        "import_authenticated_notice_export",
    ),
    "import_projection_output": (
        "campus_ingestion_worker.official_web_projection_import",
        "import_projection_output",
    ),
    "inventory_historical_handoff_record": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "inventory_historical_handoff_record",
    ),
    "load_worker_env": ("campus_ingestion_worker.env_bootstrap", "load_worker_env"),
    "migrate_student_handbook_source_faithful": (
        "campus_ingestion_worker.migrate_student_handbook_source_faithful",
        "migrate_student_handbook_source_faithful",
    ),
    "normalize_authenticated_notice_legacy_office_attachment": (
        "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment",
        "normalize_authenticated_notice_legacy_office_attachment",
    ),
    "normalize_authenticated_notice_legacy_office_attachment_main": (
        "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment",
        "main",
    ),
    "official_web_handoff_consumer_main": (
        "campus_ingestion_worker.official_web_handoff_consumer",
        "main",
    ),
    "official_web_handoff_receiver_main": (
        "campus_ingestion_worker.official_web_handoff_receiver",
        "main",
    ),
    "official_web_historical_backfill_main": (
        "campus_ingestion_worker.official_web_historical_backfill",
        "main",
    ),
    "official_web_projection_import_main": (
        "campus_ingestion_worker.official_web_projection_import",
        "main",
    ),
    "process_raw_ingestion_job": (
        "campus_ingestion_worker.process_raw_ingestion_job",
        "process_raw_ingestion_job",
    ),
    "rebuild_authenticated_notice_source_projections": (
        "campus_ingestion_worker.rebuild_authenticated_notice_source_projections",
        "rebuild_authenticated_notice_source_projections",
    ),
    "rebuild_authenticated_notice_source_truth_inventory": (
        "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory",
        "rebuild_authenticated_notice_source_truth_inventory",
    ),
    "rebuild_local_data": ("campus_ingestion_worker.rebuild_local_data", "rebuild_local_data"),
    "register_raw_asset": ("campus_ingestion_worker.register_raw_asset", "register_raw_asset"),
    "release_index_main": ("campus_ingestion_worker.release_index", "main"),
    "release_official_web_target": (
        "campus_ingestion_worker.release_official_web_target",
        "release_official_web_target",
    ),
    "release_official_web_target_main": (
        "campus_ingestion_worker.release_official_web_target",
        "main",
    ),
    "release_registry_scope_main": ("campus_ingestion_worker.release_registry_scope", "main"),
    "validate_student_handbook_chunking": (
        "campus_ingestion_worker.validate_student_handbook_chunking",
        "validate_student_handbook_chunking",
    ),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    try:
        module_name, attribute_name = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc
    value = getattr(import_module(module_name), attribute_name)
    globals()[name] = value
    return value
