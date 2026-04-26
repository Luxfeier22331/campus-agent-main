from __future__ import annotations

import os

from campus_ingestion_core.authenticated_notice_source_truth_inventory_memory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_postgres import (
    PostgresAuthenticatedNoticeSourceTruthInventoryStore,
    _list_document_registry_scope_records_for_inventory,
    _list_raw_asset_registry_scope_records_for_inventory,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_rebuild import (
    _select_latest_authenticated_notice_parent_records_for_inventory,
    build_authenticated_notice_source_truth_inventory_entries,
    build_authenticated_notice_source_truth_parent_snapshot,
    build_authenticated_notice_source_truth_parent_snapshot_from_payloads,
    document_record_from_authenticated_notice_source_truth_parent_snapshot,
    inventory_entry_from_parent_snapshot,
    rebuild_authenticated_notice_source_truth_inventory,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_shared import (
    DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY,
    DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE,
    DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA,
    DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE,
    HIGH_RISK_NOTICE_LABELS,
    NOTICE_RISK_LABEL_BODY_ONLY,
    NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    NOTICE_RISK_LABEL_REFERENCE_ONLY,
    NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
    NOTICE_RISK_LABEL_TEXT_ATTACHMENTS,
    NOTICE_RISK_LABEL_UNSUPPORTED_BINARY,
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryObjectStore,
    AuthenticatedNoticeSourceTruthInventoryStore,
    _aggregate_notice_risk_counts,
    _derive_notice_risk_label,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _postgres_connection,
)


def build_authenticated_notice_source_truth_inventory_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeSourceTruthInventoryStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when "
                "prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeSourceTruthInventoryStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or source.get(RAW_ASSET_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeSourceTruthInventoryStore(database_url=database_url)


__all__ = [
    "DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA",
    "DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE",
    "HIGH_RISK_NOTICE_LABELS",
    "NOTICE_RISK_LABEL_BODY_ONLY",
    "NOTICE_RISK_LABEL_MIXED_HIGH_RISK",
    "NOTICE_RISK_LABEL_REFERENCE_ONLY",
    "NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS",
    "NOTICE_RISK_LABEL_TEXT_ATTACHMENTS",
    "NOTICE_RISK_LABEL_UNSUPPORTED_BINARY",
    "AuthenticatedNoticeSourceTruthInventoryEntry",
    "AuthenticatedNoticeSourceTruthInventoryObjectStore",
    "AuthenticatedNoticeSourceTruthInventoryStore",
    "InMemoryAuthenticatedNoticeSourceTruthInventoryStore",
    "PostgresAuthenticatedNoticeSourceTruthInventoryStore",
    "_aggregate_notice_risk_counts",
    "_derive_notice_risk_label",
    "_list_document_registry_scope_records_for_inventory",
    "_list_raw_asset_registry_scope_records_for_inventory",
    "_postgres_connection",
    "_select_latest_authenticated_notice_parent_records_for_inventory",
    "build_authenticated_notice_source_truth_inventory_entries",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_authenticated_notice_source_truth_parent_snapshot",
    "build_authenticated_notice_source_truth_parent_snapshot_from_payloads",
    "document_record_from_authenticated_notice_source_truth_parent_snapshot",
    "inventory_entry_from_parent_snapshot",
    "rebuild_authenticated_notice_source_truth_inventory",
]
