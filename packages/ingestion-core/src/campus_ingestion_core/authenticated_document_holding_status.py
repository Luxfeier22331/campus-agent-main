from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.authenticated_common_download_import import (
    DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
    DEFAULT_COMMON_DOWNLOAD_COLLECTION,
)
from campus_ingestion_core.authenticated_notice_file_release_import import (
    DEFAULT_FILE_RELEASE_SOURCE_COLLECTION,
)
from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    build_authenticated_notice_raw_asset_id,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key

DEFAULT_CONTAMINATION_CORPUS = "campus_notices"
DEFAULT_CONTAMINATION_COLLECTION = "internal_notice"


class HoldingStatusObjectStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedDocumentHoldingStatusRow:
    unit_id: str
    source_corpus: str
    source_collection: str
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedDocumentHoldingStatusReport:
    source_corpus: str
    source_collection: str
    scope_unit_count: int
    action_required_count: int
    holding_inventory_count: int
    holding_document_count: int
    holding_raw_asset_count: int
    wrong_scope_inventory_count: int
    wrong_scope_document_count: int
    wrong_scope_raw_asset_count: int
    downstream_projection_count: int
    downstream_read_model_count: int
    reason_counts: dict[str, int]
    rows: tuple[AuthenticatedDocumentHoldingStatusRow, ...]


def build_authenticated_document_holding_status_report(
    *,
    source_corpus: str,
    source_collection: str,
    document_registry: Any,
    raw_asset_registry: Any,
    source_truth_inventory_store: Any,
    file_release_inventory_store: Any,
    projection_store: Any,
    read_model_store: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
    notice_ids: Sequence[str] = (),
    file_release_ids: Sequence[int | str] = (),
    contamination_corpus: str = DEFAULT_CONTAMINATION_CORPUS,
    contamination_collection: str = DEFAULT_CONTAMINATION_COLLECTION,
) -> AuthenticatedDocumentHoldingStatusReport:
    if (source_corpus, source_collection) == (
        DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
        DEFAULT_COMMON_DOWNLOAD_COLLECTION,
    ):
        return _build_common_download_status_report(
            source_corpus=source_corpus,
            source_collection=source_collection,
            notice_ids=notice_ids,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=source_truth_inventory_store,
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=source_bucket,
            contamination_corpus=contamination_corpus,
            contamination_collection=contamination_collection,
        )
    if (source_corpus, source_collection) == (
        DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
        DEFAULT_FILE_RELEASE_SOURCE_COLLECTION,
    ):
        return _build_file_release_status_report(
            source_corpus=source_corpus,
            source_collection=source_collection,
            file_release_ids=file_release_ids,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            file_release_inventory_store=file_release_inventory_store,
            object_store=object_store,
            source_bucket=source_bucket,
        )
    raise ValueError(
        "authenticated document holding status only supports "
        "authenticated_documents/common_download_source or "
        "authenticated_documents/file_release_source"
    )


def _build_common_download_status_report(
    *,
    source_corpus: str,
    source_collection: str,
    notice_ids: Sequence[str],
    document_registry: Any,
    raw_asset_registry: Any,
    source_truth_inventory_store: Any,
    projection_store: Any,
    read_model_store: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
    contamination_corpus: str,
    contamination_collection: str,
) -> AuthenticatedDocumentHoldingStatusReport:
    normalized_notice_ids = _normalize_text_ids(notice_ids)
    holding_inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            source_corpus,
            source_collection,
            notice_ids=normalized_notice_ids,
        )
    )
    holding_documents = tuple(
        _filter_document_rows_by_notice_ids(
            document_registry.list_by_scope(source_corpus, source_collection),
            normalized_notice_ids,
        )
    )
    holding_raw_assets = tuple(
        _filter_raw_rows_by_notice_ids(
            raw_asset_registry.list_by_scope(source_corpus, source_collection),
            normalized_notice_ids,
        )
    )
    wrong_scope_inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=normalized_notice_ids,
        )
    )
    wrong_scope_documents = tuple(
        _filter_document_rows_by_notice_ids(
            document_registry.list_by_scope(contamination_corpus, contamination_collection),
            normalized_notice_ids,
        )
    )
    wrong_scope_raw_assets = tuple(
        _filter_raw_rows_by_notice_ids(
            raw_asset_registry.list_by_scope(contamination_corpus, contamination_collection),
            normalized_notice_ids,
        )
    )
    projection_rows = tuple(
        projection_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=normalized_notice_ids,
        )
    )
    read_model_rows = tuple(
        read_model_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=normalized_notice_ids,
        )
    )
    unit_ids = _normalize_text_ids(
        normalized_notice_ids
        or tuple(row.notice_id for row in holding_inventory_rows)
        + tuple(row.notice_id for row in wrong_scope_inventory_rows)
        + tuple(getattr(row, "source_notice_id", "") for row in projection_rows)
        + tuple(getattr(row, "source_notice_id", "") for row in read_model_rows)
        + tuple(_notice_id_from_document_id(row.document_id) for row in wrong_scope_documents)
    )
    holding_inventory_by_notice = {str(row.notice_id): row for row in holding_inventory_rows}
    holding_documents_by_notice = _group_documents_by_notice_id(holding_documents)
    holding_raw_assets_by_notice = _group_raw_assets_by_notice_id(holding_raw_assets)
    wrong_scope_inventory_notice_ids = {str(row.notice_id) for row in wrong_scope_inventory_rows}
    wrong_scope_document_notice_ids = set(_group_documents_by_notice_id(wrong_scope_documents))
    wrong_scope_raw_notice_ids = set(_group_raw_assets_by_notice_id(wrong_scope_raw_assets))
    projection_notice_ids = {
        str(getattr(row, "source_notice_id", "")).strip() for row in projection_rows
    }
    read_model_notice_ids = {
        str(getattr(row, "source_notice_id", "")).strip() for row in read_model_rows
    }

    rows: list[AuthenticatedDocumentHoldingStatusRow] = []
    reason_counts = Counter()
    for notice_id in unit_ids:
        reasons: list[str] = []
        holding_row = holding_inventory_by_notice.get(notice_id)
        if holding_row is None:
            reasons.append("missing_holding_inventory")
        else:
            if not holding_documents_by_notice.get(notice_id):
                reasons.append("missing_document_registry")
            if not holding_raw_assets_by_notice.get(notice_id):
                reasons.append("missing_raw_asset")
            if _missing_object_keys(
                object_store=object_store,
                bucket=source_bucket,
                object_keys=_holding_notice_source_keys(holding_row),
            ):
                reasons.append("missing_source_artifact")
        if (
            notice_id in wrong_scope_inventory_notice_ids
            or notice_id in wrong_scope_document_notice_ids
            or notice_id in wrong_scope_raw_notice_ids
        ):
            reasons.append("wrong_scope_residue")
        if notice_id in projection_notice_ids or notice_id in read_model_notice_ids:
            reasons.append("downstream_contamination")
        reason_counts.update(reasons)
        rows.append(
            AuthenticatedDocumentHoldingStatusRow(
                unit_id=notice_id,
                source_corpus=source_corpus,
                source_collection=source_collection,
                reason_codes=tuple(dict.fromkeys(reasons)),
            )
        )

    return AuthenticatedDocumentHoldingStatusReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        scope_unit_count=len(rows),
        action_required_count=sum(1 for row in rows if row.reason_codes),
        holding_inventory_count=len(holding_inventory_rows),
        holding_document_count=len(holding_documents),
        holding_raw_asset_count=len(holding_raw_assets),
        wrong_scope_inventory_count=len(wrong_scope_inventory_rows),
        wrong_scope_document_count=len(wrong_scope_documents),
        wrong_scope_raw_asset_count=len(wrong_scope_raw_assets),
        downstream_projection_count=len(projection_rows),
        downstream_read_model_count=len(read_model_rows),
        reason_counts=dict(sorted(reason_counts.items())),
        rows=tuple(rows),
    )


def _build_file_release_status_report(
    *,
    source_corpus: str,
    source_collection: str,
    file_release_ids: Sequence[int | str],
    document_registry: Any,
    raw_asset_registry: Any,
    file_release_inventory_store: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
) -> AuthenticatedDocumentHoldingStatusReport:
    normalized_file_release_ids = _normalize_int_ids(file_release_ids)
    inventory_rows = tuple(
        file_release_inventory_store.list_by_scope(
            source_corpus,
            source_collection,
            file_release_ids=normalized_file_release_ids,
        )
    )
    documents = tuple(
        _filter_document_rows_by_file_release_ids(
            document_registry.list_by_scope(source_corpus, source_collection),
            normalized_file_release_ids,
        )
    )
    raw_assets = tuple(
        _filter_raw_rows_by_file_release_ids(
            raw_asset_registry.list_by_scope(source_corpus, source_collection),
            normalized_file_release_ids,
        )
    )
    unit_ids = normalized_file_release_ids or tuple(
        str(row.file_release_id) for row in inventory_rows
    )
    inventory_by_id = {str(row.file_release_id): row for row in inventory_rows}
    documents_by_id = _group_documents_by_file_release_id(documents)
    raw_assets_by_id = _group_raw_assets_by_file_release_id(raw_assets)

    rows: list[AuthenticatedDocumentHoldingStatusRow] = []
    reason_counts = Counter()
    for unit_id in unit_ids:
        reasons: list[str] = []
        inventory_row = inventory_by_id.get(unit_id)
        if inventory_row is None:
            reasons.append("missing_holding_inventory")
        else:
            if not documents_by_id.get(unit_id):
                reasons.append("missing_document_registry")
            if not raw_assets_by_id.get(unit_id):
                reasons.append("missing_raw_asset")
            if _missing_object_keys(
                object_store=object_store,
                bucket=source_bucket,
                object_keys=_holding_file_release_source_keys(inventory_row),
            ):
                reasons.append("missing_source_artifact")
        reason_counts.update(reasons)
        rows.append(
            AuthenticatedDocumentHoldingStatusRow(
                unit_id=unit_id,
                source_corpus=source_corpus,
                source_collection=source_collection,
                reason_codes=tuple(dict.fromkeys(reasons)),
            )
        )

    return AuthenticatedDocumentHoldingStatusReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        scope_unit_count=len(rows),
        action_required_count=sum(1 for row in rows if row.reason_codes),
        holding_inventory_count=len(inventory_rows),
        holding_document_count=len(documents),
        holding_raw_asset_count=len(raw_assets),
        wrong_scope_inventory_count=0,
        wrong_scope_document_count=0,
        wrong_scope_raw_asset_count=0,
        downstream_projection_count=0,
        downstream_read_model_count=0,
        reason_counts=dict(sorted(reason_counts.items())),
        rows=tuple(rows),
    )


def _missing_object_keys(
    *,
    object_store: HoldingStatusObjectStore,
    bucket: str,
    object_keys: Sequence[str],
) -> tuple[str, ...]:
    missing: list[str] = []
    for object_key in object_keys:
        if not object_key:
            continue
        try:
            object_store.head_object(bucket=bucket, key=object_key)
        except Exception:
            missing.append(object_key)
    return tuple(missing)


def _holding_notice_source_keys(row: Any) -> tuple[str, ...]:
    parent_snapshot = dict(getattr(row, "parent_snapshot", {}) or {})
    source_artifact_keys = parent_snapshot.get("source_artifact_keys")
    if isinstance(source_artifact_keys, list):
        return tuple(str(item).strip() for item in source_artifact_keys if str(item).strip())
    return tuple(
        key
        for key in (
            str(getattr(row, "notice_manifest_key", "") or "").strip(),
            str(getattr(row, "content_blocks_key", "") or "").strip(),
            str(getattr(row, "attachment_refs_key", "") or "").strip(),
        )
        if key
    )


def _holding_file_release_source_keys(row: Any) -> tuple[str, ...]:
    record = dict(getattr(row, "record", {}) or {})
    source_artifact_keys = record.get("source_artifact_keys")
    if not isinstance(source_artifact_keys, dict):
        return ()
    return tuple(str(item).strip() for item in source_artifact_keys.values() if str(item).strip())


def _filter_document_rows_by_notice_ids(
    records: Sequence[DocumentRegistryRecord],
    notice_ids: Sequence[str],
) -> tuple[DocumentRegistryRecord, ...]:
    normalized_notice_ids = set(_normalize_text_ids(notice_ids))
    return tuple(
        record
        for record in records
        if not normalized_notice_ids
        or (_notice_id_from_document_id(record.document_id) in normalized_notice_ids)
    )


def _filter_raw_rows_by_notice_ids(
    records: Sequence[RawAssetRecord],
    notice_ids: Sequence[str],
) -> tuple[RawAssetRecord, ...]:
    normalized_notice_ids = set(_normalize_text_ids(notice_ids))
    return tuple(
        record
        for record in records
        if not normalized_notice_ids
        or _notice_id_from_raw_asset_id(record.raw_asset_id) in normalized_notice_ids
    )


def _filter_document_rows_by_file_release_ids(
    records: Sequence[DocumentRegistryRecord],
    file_release_ids: Sequence[str],
) -> tuple[DocumentRegistryRecord, ...]:
    normalized_ids = set(file_release_ids)
    return tuple(
        record
        for record in records
        if not normalized_ids
        or _file_release_id_from_document_id(record.document_id) in normalized_ids
    )


def _filter_raw_rows_by_file_release_ids(
    records: Sequence[RawAssetRecord],
    file_release_ids: Sequence[str],
) -> tuple[RawAssetRecord, ...]:
    normalized_ids = set(file_release_ids)
    return tuple(
        record
        for record in records
        if not normalized_ids
        or _file_release_id_from_raw_asset_id(record.raw_asset_id) in normalized_ids
    )


def _group_documents_by_notice_id(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, tuple[DocumentRegistryRecord, ...]]:
    grouped: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        notice_id = _notice_id_from_document_id(record.document_id)
        if notice_id is None:
            continue
        grouped.setdefault(notice_id, []).append(record)
    return {key: tuple(value) for key, value in grouped.items()}


def _group_raw_assets_by_notice_id(
    records: Sequence[RawAssetRecord],
) -> dict[str, tuple[RawAssetRecord, ...]]:
    grouped: dict[str, list[RawAssetRecord]] = {}
    for record in records:
        notice_id = _notice_id_from_raw_asset_id(record.raw_asset_id)
        if notice_id is None:
            continue
        grouped.setdefault(notice_id, []).append(record)
    return {key: tuple(value) for key, value in grouped.items()}


def _group_documents_by_file_release_id(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, tuple[DocumentRegistryRecord, ...]]:
    grouped: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        unit_id = _file_release_id_from_document_id(record.document_id)
        if unit_id is None:
            continue
        grouped.setdefault(unit_id, []).append(record)
    return {key: tuple(value) for key, value in grouped.items()}


def _group_raw_assets_by_file_release_id(
    records: Sequence[RawAssetRecord],
) -> dict[str, tuple[RawAssetRecord, ...]]:
    grouped: dict[str, list[RawAssetRecord]] = {}
    for record in records:
        unit_id = _file_release_id_from_raw_asset_id(record.raw_asset_id)
        if unit_id is None:
            continue
        grouped.setdefault(unit_id, []).append(record)
    return {key: tuple(value) for key, value in grouped.items()}


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


def _file_release_id_from_document_id(document_id: str) -> str | None:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[0] == "file-release":
        return parts[2] or None
    return None


def _file_release_id_from_raw_asset_id(raw_asset_id: str) -> str | None:
    parts = [part.strip() for part in str(raw_asset_id).split(":")]
    if len(parts) == 4 and parts[:2] == ["asset", "file-release"]:
        return parts[3] or None
    return None


def _normalize_text_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _normalize_int_ids(values: Sequence[int | str]) -> tuple[str, ...]:
    normalized: list[str] = []
    for value in values:
        text = str(value).strip()
        if text:
            normalized.append(str(int(text)))
    return tuple(sorted(set(normalized)))


__all__ = [
    "AuthenticatedDocumentHoldingStatusReport",
    "AuthenticatedDocumentHoldingStatusRow",
    "build_authenticated_document_holding_status_report",
]
