from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_common_download_import import (
    DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
    DEFAULT_COMMON_DOWNLOAD_COLLECTION,
)
from campus_ingestion_core.authenticated_document_holding_status import (
    DEFAULT_CONTAMINATION_COLLECTION,
    DEFAULT_CONTAMINATION_CORPUS,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    document_record_from_authenticated_notice_source_truth_parent_snapshot,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.registry import _raw_asset_record_from_dict


@dataclass(frozen=True, slots=True)
class AuthenticatedCommonDownloadDownstreamResetReport:
    purged_notice_ids: tuple[str, ...]
    inventory_row_removed_count: int
    document_row_removed_count: int
    raw_asset_row_removed_count: int
    projection_row_removed_count: int
    read_model_row_removed_count: int
    source_artifact_removed_count: int
    derived_artifact_removed_count: int


def reset_authenticated_common_download_downstream_state(
    *,
    site_id: str,
    notice_ids: Sequence[str],
    source_truth_inventory_store: Any,
    document_registry: Any,
    raw_asset_registry: Any,
    projection_store: Any,
    read_model_store: Any,
    object_store: Any,
    source_bucket: str,
    derived_bucket: str,
    contamination_corpus: str = DEFAULT_CONTAMINATION_CORPUS,
    contamination_collection: str = DEFAULT_CONTAMINATION_COLLECTION,
) -> AuthenticatedCommonDownloadDownstreamResetReport:
    selected_notice_ids = _normalize_notice_ids(notice_ids)
    if not selected_notice_ids:
        raise ValueError("selected notice_ids are required")

    inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=selected_notice_ids,
        )
    )
    document_rows = tuple(
        _filter_document_rows_by_notice_ids(
            document_registry.list_by_scope(contamination_corpus, contamination_collection),
            selected_notice_ids,
        )
    )
    raw_asset_rows = tuple(
        _filter_raw_rows_by_notice_ids(
            raw_asset_registry.list_by_scope(contamination_corpus, contamination_collection),
            selected_notice_ids,
        )
    )
    projection_rows = tuple(
        projection_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=selected_notice_ids,
        )
    )
    read_model_rows = tuple(
        read_model_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=selected_notice_ids,
        )
    )

    source_object_keys, derived_object_keys = _collect_object_keys(
        inventory_rows=inventory_rows,
        document_rows=document_rows,
        raw_asset_rows=raw_asset_rows,
    )

    for object_key in source_object_keys:
        _delete_object_if_present(object_store, bucket=source_bucket, key=object_key)
    for object_key in derived_object_keys:
        _delete_object_if_present(object_store, bucket=derived_bucket, key=object_key)

    for row in document_rows:
        document_registry.delete_document(str(row.document_id))

    remaining_inventory_rows = tuple(
        row
        for row in source_truth_inventory_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
        )
        if str(getattr(row, "notice_id", "")).strip() not in set(selected_notice_ids)
    )
    source_truth_inventory_store.replace_scope(
        contamination_corpus,
        contamination_collection,
        remaining_inventory_rows,
    )

    remaining_raw_rows = tuple(
        row
        for row in raw_asset_registry.list_by_scope(contamination_corpus, contamination_collection)
        if _notice_id_from_raw_asset_id(str(row.raw_asset_id)) not in set(selected_notice_ids)
    )
    raw_asset_registry.replace_scope(
        contamination_corpus,
        contamination_collection,
        remaining_raw_rows,
    )

    projection_store.replace_notices(
        contamination_corpus,
        contamination_collection,
        notice_ids=selected_notice_ids,
        records=(),
    )
    read_model_store.replace_notices(
        contamination_corpus,
        contamination_collection,
        notice_ids=selected_notice_ids,
        records=(),
    )
    _restore_holding_scope_records(
        notice_ids=selected_notice_ids,
        source_truth_inventory_store=source_truth_inventory_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
    )

    return AuthenticatedCommonDownloadDownstreamResetReport(
        purged_notice_ids=selected_notice_ids,
        inventory_row_removed_count=len(inventory_rows),
        document_row_removed_count=len(document_rows),
        raw_asset_row_removed_count=len(raw_asset_rows),
        projection_row_removed_count=len(projection_rows),
        read_model_row_removed_count=len(read_model_rows),
        source_artifact_removed_count=len(source_object_keys),
        derived_artifact_removed_count=len(derived_object_keys),
    )


def _collect_object_keys(
    *,
    inventory_rows: Sequence[Any],
    document_rows: Sequence[DocumentRegistryRecord],
    raw_asset_rows: Sequence[RawAssetRecord],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    source_keys: list[str] = []
    derived_keys: list[str] = []
    for row in inventory_rows:
        parent_snapshot = dict(getattr(row, "parent_snapshot", {}) or {})
        for object_key in list(parent_snapshot.get("source_artifact_keys") or []):
            text = str(object_key).strip()
            if text:
                source_keys.append(text)
    for row in raw_asset_rows:
        key = str(getattr(row, "object_key", "") or "").strip()
        if key:
            source_keys.append(key)
    for row in document_rows:
        source_keys.extend(
            key
            for key in (
                str(getattr(row, "provider_response_object_key", "") or "").strip(),
                *[
                    str(item).strip()
                    for item in tuple(getattr(row, "processed_object_keys", ()) or ())
                    if str(item).strip() and is_source_object_key(str(item))
                ],
            )
            if key
        )
        derived_keys.extend(
            key
            for key in (
                str(getattr(row, "canonical_markdown_object_key", "") or "").strip(),
                str(getattr(row, "document_units_object_key", "") or "").strip(),
                *[
                    str(item).strip()
                    for item in tuple(getattr(row, "processed_object_keys", ()) or ())
                    if str(item).strip() and not is_source_object_key(str(item))
                ],
            )
            if key
        )
    return tuple(dict.fromkeys(source_keys)), tuple(dict.fromkeys(derived_keys))


def _filter_document_rows_by_notice_ids(
    records: Sequence[DocumentRegistryRecord],
    notice_ids: Sequence[str],
) -> tuple[DocumentRegistryRecord, ...]:
    selected = set(_normalize_notice_ids(notice_ids))
    return tuple(
        row for row in records if _notice_id_from_document_id(str(row.document_id)) in selected
    )


def _filter_raw_rows_by_notice_ids(
    records: Sequence[RawAssetRecord],
    notice_ids: Sequence[str],
) -> tuple[RawAssetRecord, ...]:
    selected = set(_normalize_notice_ids(notice_ids))
    return tuple(
        row for row in records if _notice_id_from_raw_asset_id(str(row.raw_asset_id)) in selected
    )


def _notice_id_from_document_id(document_id: str) -> str | None:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[0] == "notice":
        return parts[2] or None
    if len(parts) >= 4 and parts[0] == "notice_attachment":
        return parts[2] or None
    return None


def _notice_id_from_raw_asset_id(raw_asset_id: str) -> str | None:
    parts = [part.strip() for part in str(raw_asset_id).split(":")]
    if len(parts) == 4 and parts[:2] == ["asset", "authenticated-notice"]:
        return parts[3] or None
    return None


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _delete_object_if_present(object_store: Any, *, bucket: str, key: str) -> None:
    try:
        object_store.delete_object(bucket=bucket, key=key)
    except Exception:
        return


def _restore_holding_scope_records(
    *,
    notice_ids: Sequence[str],
    source_truth_inventory_store: Any,
    document_registry: Any,
    raw_asset_registry: Any,
) -> None:
    holding_inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
            DEFAULT_COMMON_DOWNLOAD_COLLECTION,
            notice_ids=notice_ids,
        )
    )
    if not holding_inventory_rows:
        return
    selected_notice_id_set = set(_normalize_notice_ids(notice_ids))
    existing_document_rows = tuple(
        row
        for row in document_registry.list_by_scope(
            DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
            DEFAULT_COMMON_DOWNLOAD_COLLECTION,
        )
        if _notice_id_from_document_id(str(row.document_id)) not in selected_notice_id_set
    )
    rebuilt_document_rows = tuple(
        document_record_from_authenticated_notice_source_truth_parent_snapshot(
            dict(getattr(row, "parent_snapshot", {}) or {})
        )
        for row in holding_inventory_rows
    )
    document_registry.replace_scope(
        DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
        DEFAULT_COMMON_DOWNLOAD_COLLECTION,
        existing_document_rows + rebuilt_document_rows,
    )

    existing_raw_rows = tuple(
        row
        for row in raw_asset_registry.list_by_scope(
            DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
            DEFAULT_COMMON_DOWNLOAD_COLLECTION,
        )
        if _notice_id_from_raw_asset_id(str(row.raw_asset_id)) not in selected_notice_id_set
    )
    rebuilt_raw_rows = tuple(
        _raw_asset_record_from_dict(
            dict((dict(getattr(row, "parent_snapshot", {}) or {})).get("raw_record") or {})
        )
        for row in holding_inventory_rows
    )
    raw_asset_registry.replace_scope(
        DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
        DEFAULT_COMMON_DOWNLOAD_COLLECTION,
        existing_raw_rows + rebuilt_raw_rows,
    )


__all__ = [
    "AuthenticatedCommonDownloadDownstreamResetReport",
    "reset_authenticated_common_download_downstream_state",
]
