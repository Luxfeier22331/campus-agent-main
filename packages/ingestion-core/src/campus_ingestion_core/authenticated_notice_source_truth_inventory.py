from __future__ import annotations

import os

from campus_ingestion_core.authenticated_notice_source_truth_inventory_memory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory_rebuild import (
    _list_document_registry_scope_records_for_inventory,
    _list_raw_asset_registry_scope_records_for_inventory,
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
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired


def build_authenticated_notice_source_truth_inventory_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> AuthenticatedNoticeSourceTruthInventoryStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("authenticated notice source truth inventory")


__all__ = [
    "DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY",
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
    "_aggregate_notice_risk_counts",
    "_derive_notice_risk_label",
    "_list_document_registry_scope_records_for_inventory",
    "_list_raw_asset_registry_scope_records_for_inventory",
    "_select_latest_authenticated_notice_parent_records_for_inventory",
    "build_authenticated_notice_source_truth_inventory_entries",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_authenticated_notice_source_truth_parent_snapshot",
    "build_authenticated_notice_source_truth_parent_snapshot_from_payloads",
    "document_record_from_authenticated_notice_source_truth_parent_snapshot",
    "inventory_entry_from_parent_snapshot",
    "rebuild_authenticated_notice_source_truth_inventory",
]
