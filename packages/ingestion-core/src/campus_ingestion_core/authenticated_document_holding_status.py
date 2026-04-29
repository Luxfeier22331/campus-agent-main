from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.authenticated_common_download_import import (
    COMMON_DOWNLOAD_NOTICE_TYPE_ID,
    DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
    DEFAULT_COMMON_DOWNLOAD_COLLECTION,
)
from campus_ingestion_core.authenticated_notice_file_release_import import (
    DEFAULT_FILE_RELEASE_SOURCE_COLLECTION,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
    DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord

DEFAULT_CONTAMINATION_CORPUS = "campus_notices"
DEFAULT_CONTAMINATION_COLLECTION = "internal_notice"
COMMON_DOWNLOAD_NOTICE_TYPE_NAME = "常用下载"


class HoldingStatusObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedDocumentHoldingStatusRow:
    unit_id: str
    source_corpus: str
    source_collection: str
    reason_codes: tuple[str, ...]
    holding_stage: str


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
    holding_stage_counts: dict[str, int]
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
            projection_store=projection_store,
            read_model_store=read_model_store,
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
    contamination_inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=normalized_notice_ids,
        )
    )
    target_notice_ids = normalized_notice_ids
    wrong_scope_inventory_rows = contamination_inventory_rows
    if not normalized_notice_ids:
        notice_type_cache: dict[str, tuple[str, ...]] = {}
        wrong_scope_inventory_rows = tuple(
            row
            for row in contamination_inventory_rows
            if _inventory_row_matches_common_download(
                row=row,
                object_store=object_store,
                source_bucket=source_bucket,
                notice_type_cache=notice_type_cache,
            )
        )
        target_notice_ids = _normalize_text_ids(
            tuple(str(row.notice_id) for row in holding_inventory_rows)
            + tuple(str(row.notice_id) for row in wrong_scope_inventory_rows)
        )
        if not target_notice_ids:
            return _empty_authenticated_document_holding_status_report(
                source_corpus=source_corpus,
                source_collection=source_collection,
            )
    holding_documents = tuple(
        _filter_document_rows_by_notice_ids(
            document_registry.list_by_scope(source_corpus, source_collection),
            target_notice_ids,
        )
    )
    holding_raw_assets = tuple(
        _filter_raw_rows_by_notice_ids(
            raw_asset_registry.list_by_scope(source_corpus, source_collection),
            target_notice_ids,
        )
    )
    wrong_scope_documents = tuple(
        _filter_document_rows_by_notice_ids(
            document_registry.list_by_scope(contamination_corpus, contamination_collection),
            target_notice_ids,
        )
    )
    wrong_scope_raw_assets = tuple(
        _filter_raw_rows_by_notice_ids(
            raw_asset_registry.list_by_scope(contamination_corpus, contamination_collection),
            target_notice_ids,
        )
    )
    projection_rows = tuple(
        projection_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=target_notice_ids,
        )
    )
    read_model_rows = tuple(
        read_model_store.list_by_scope(
            contamination_corpus,
            contamination_collection,
            notice_ids=target_notice_ids,
        )
    )
    unit_ids = target_notice_ids
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
                holding_stage="action_required" if reasons else "imported_holding",
            )
        )

    stage_counts = Counter(row.holding_stage for row in rows)
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
        holding_stage_counts=dict(sorted(stage_counts.items())),
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
    projection_store: Any,
    read_model_store: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
) -> AuthenticatedDocumentHoldingStatusReport:
    normalized_file_release_ids = _normalize_int_ids(file_release_ids)
    capture_inventory_rows = tuple(
        file_release_inventory_store.list_by_scope(
            DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
            DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
            file_release_ids=normalized_file_release_ids,
        )
    )
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
    projection_rows = tuple(
        projection_store.list_by_scope(
            source_corpus,
            source_collection,
            notice_ids=tuple(str(item) for item in normalized_file_release_ids),
        )
    )
    read_model_rows = tuple(
        read_model_store.list_by_scope(
            source_corpus,
            source_collection,
            notice_ids=tuple(str(item) for item in normalized_file_release_ids),
        )
    )
    unit_ids = normalized_file_release_ids or _normalize_text_ids(
        tuple(str(row.file_release_id) for row in inventory_rows)
        + tuple(str(row.file_release_id) for row in capture_inventory_rows)
        + tuple(str(getattr(row, "source_notice_id", "") or "") for row in projection_rows)
        + tuple(str(getattr(row, "source_notice_id", "") or "") for row in read_model_rows)
    )
    inventory_by_id = {str(row.file_release_id): row for row in inventory_rows}
    capture_inventory_by_id = {str(row.file_release_id): row for row in capture_inventory_rows}
    documents_by_id = _group_documents_by_file_release_id(documents)
    raw_assets_by_id = _group_raw_assets_by_file_release_id(raw_assets)
    projection_ids = {
        str(getattr(row, "source_notice_id", "") or "").strip() for row in projection_rows
    }
    read_model_ids = {
        str(getattr(row, "source_notice_id", "") or "").strip() for row in read_model_rows
    }

    rows: list[AuthenticatedDocumentHoldingStatusRow] = []
    reason_counts = Counter()
    for unit_id in unit_ids:
        reasons: list[str] = []
        inventory_row = inventory_by_id.get(unit_id)
        capture_inventory_row = capture_inventory_by_id.get(unit_id)
        stage = "missing_holding"
        if inventory_row is None:
            reasons.append("missing_holding_inventory")
            if capture_inventory_row is not None:
                source_problem = _file_release_source_object_problem(
                    row=capture_inventory_row,
                    object_store=object_store,
                )
                if source_problem is None:
                    stage = "object_backed_source_ready"
                    reasons.append("not_imported_to_holding")
                else:
                    stage = "captured_only"
                    reasons.append(source_problem)
        else:
            stage = "imported_holding"
            if not documents_by_id.get(unit_id):
                reasons.append("missing_document_registry")
            if not raw_assets_by_id.get(unit_id):
                reasons.append("missing_raw_asset")
            source_problem = _file_release_source_object_problem(
                row=inventory_row,
                object_store=object_store,
            )
            if source_problem is not None:
                reasons.append(source_problem)
            if _missing_object_keys(
                object_store=object_store,
                bucket=source_bucket,
                object_keys=_holding_file_release_source_keys(inventory_row),
            ):
                reasons.append("missing_source_artifact")
            if reasons:
                stage = "import_incomplete"
        if unit_id in projection_ids or unit_id in read_model_ids:
            stage = "downstream_admitted"
            reasons.append("downstream_admitted")
        reason_counts.update(reasons)
        rows.append(
            AuthenticatedDocumentHoldingStatusRow(
                unit_id=unit_id,
                source_corpus=source_corpus,
                source_collection=source_collection,
                reason_codes=tuple(dict.fromkeys(reasons)),
                holding_stage=stage,
            )
        )

    stage_counts = Counter(row.holding_stage for row in rows)
    return AuthenticatedDocumentHoldingStatusReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        scope_unit_count=len(rows),
        action_required_count=sum(1 for row in rows if row.reason_codes),
        holding_inventory_count=len(inventory_rows),
        holding_document_count=len(documents),
        holding_raw_asset_count=len(raw_assets),
        wrong_scope_inventory_count=len(capture_inventory_rows),
        wrong_scope_document_count=0,
        wrong_scope_raw_asset_count=0,
        downstream_projection_count=len(projection_rows),
        downstream_read_model_count=len(read_model_rows),
        reason_counts=dict(sorted(reason_counts.items())),
        holding_stage_counts=dict(sorted(stage_counts.items())),
        rows=tuple(rows),
    )


def _empty_authenticated_document_holding_status_report(
    *,
    source_corpus: str,
    source_collection: str,
) -> AuthenticatedDocumentHoldingStatusReport:
    return AuthenticatedDocumentHoldingStatusReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        scope_unit_count=0,
        action_required_count=0,
        holding_inventory_count=0,
        holding_document_count=0,
        holding_raw_asset_count=0,
        wrong_scope_inventory_count=0,
        wrong_scope_document_count=0,
        wrong_scope_raw_asset_count=0,
        downstream_projection_count=0,
        downstream_read_model_count=0,
        reason_counts={},
        holding_stage_counts={},
        rows=(),
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


def _file_release_source_object_problem(
    *,
    row: Any,
    object_store: HoldingStatusObjectStore,
) -> str | None:
    if str(getattr(row, "released_file_storage_provider", "") or "").strip() != "object_store":
        return "captured_only_without_source_bytes"
    bucket = str(getattr(row, "released_file_bucket", "") or "").strip()
    object_key = str(getattr(row, "released_file_object_key", "") or "").strip()
    expected_sha256 = str(getattr(row, "released_file_sha256", "") or "").strip()
    expected_byte_size = getattr(row, "released_file_byte_size", None)
    if not bucket or not object_key or not expected_sha256 or expected_byte_size is None:
        return "captured_only_without_source_bytes"
    try:
        payload = object_store.get_bytes(bucket=bucket, key=object_key)
    except Exception:
        return "missing_source_bytes"
    try:
        byte_size = int(expected_byte_size)
    except (TypeError, ValueError):
        return "captured_only_without_source_bytes"
    if len(payload) != byte_size:
        return "size_mismatch"
    if hashlib.sha256(payload).hexdigest() != expected_sha256:
        return "checksum_mismatch"
    return None


def _inventory_row_matches_common_download(
    *,
    row: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
    notice_type_cache: dict[str, tuple[str, ...]],
) -> bool:
    notice_type_ids = _inventory_row_notice_type_ids(
        row=row,
        object_store=object_store,
        source_bucket=source_bucket,
        notice_type_cache=notice_type_cache,
    )
    if COMMON_DOWNLOAD_NOTICE_TYPE_ID in notice_type_ids:
        return True
    parent_snapshot = dict(getattr(row, "parent_snapshot", {}) or {})
    notice_type_names = {
        str(item).strip()
        for item in list(parent_snapshot.get("notice_type_names") or ())
        if str(item).strip()
    }
    return COMMON_DOWNLOAD_NOTICE_TYPE_NAME in notice_type_names


def _inventory_row_notice_type_ids(
    *,
    row: Any,
    object_store: HoldingStatusObjectStore,
    source_bucket: str,
    notice_type_cache: dict[str, tuple[str, ...]],
) -> tuple[str, ...]:
    parent_snapshot = dict(getattr(row, "parent_snapshot", {}) or {})
    snapshot_notice_type_ids = _normalize_text_ids(parent_snapshot.get("notice_type_ids") or ())
    if snapshot_notice_type_ids:
        return snapshot_notice_type_ids
    notice_manifest_key = str(
        getattr(row, "notice_manifest_key", "") or parent_snapshot.get("notice_manifest_key") or ""
    ).strip()
    if not notice_manifest_key:
        return ()
    cached = notice_type_cache.get(notice_manifest_key)
    if cached is not None:
        return cached
    try:
        manifest = json.loads(
            object_store.get_bytes(bucket=source_bucket, key=notice_manifest_key).decode("utf-8")
        )
    except Exception:
        notice_type_cache[notice_manifest_key] = ()
        return ()
    if not isinstance(manifest, dict):
        notice_type_cache[notice_manifest_key] = ()
        return ()
    notice_type_ids = _normalize_text_ids(manifest.get("notice_type_ids") or ())
    notice_type_cache[notice_manifest_key] = notice_type_ids
    return notice_type_ids


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
