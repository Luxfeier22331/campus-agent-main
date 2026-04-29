from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry


class TargetMaterializationObjectReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


_NOTICE_PROVENANCE_KEYS = (
    "source_notice_id",
    "source_notice_ids",
)
_DOCUMENT_PROVENANCE_KEYS = (
    "derived_from_document_id",
    "derived_from_document_ids",
    "parent_document_id",
    "semantic_owner_document_id",
    "semantic_owner_document_ids",
    "source_attachment_document_id",
    "source_attachment_document_ids",
    "source_document_id",
    "source_document_ids",
    "source_notice_document_id",
    "source_notice_document_ids",
    "source_parent_document_id",
    "source_parent_document_ids",
)


def replace_selected_target_scope_preserving_unselected(
    *,
    registry: DocumentRegistry,
    object_store: TargetMaterializationObjectReader,
    bucket_derived: str,
    target_scope: tuple[str, str],
    selected_notice_ids: Sequence[str] = (),
    selected_document_ids: Sequence[str] = (),
) -> None:
    notice_id_set = set(_normalize_ids(selected_notice_ids))
    document_id_set = set(_normalize_ids(selected_document_ids))
    if not notice_id_set and not document_id_set:
        return

    existing_records = registry.list_by_scope(target_scope[0], target_scope[1])
    preserved_records = tuple(
        record
        for record in existing_records
        if not _target_record_matches_selection(
            record=record,
            object_store=object_store,
            bucket_derived=bucket_derived,
            selected_notice_ids=notice_id_set,
            selected_document_ids=document_id_set,
        )
    )
    registry.replace_scope(target_scope[0], target_scope[1], preserved_records)


def _target_record_matches_selection(
    *,
    record: DocumentRegistryRecord,
    object_store: TargetMaterializationObjectReader,
    bucket_derived: str,
    selected_notice_ids: set[str],
    selected_document_ids: set[str],
) -> bool:
    if _uri_matches_selection(
        record.source_uri,
        selected_notice_ids=selected_notice_ids,
        selected_document_ids=selected_document_ids,
    ):
        return True
    for observation in record.source_observations:
        if _uri_matches_selection(
            observation.source_uri,
            selected_notice_ids=selected_notice_ids,
            selected_document_ids=selected_document_ids,
        ):
            return True

    provenance = _load_target_record_provenance(
        record=record,
        object_store=object_store,
        bucket_derived=bucket_derived,
    )
    return bool(
        selected_notice_ids.intersection(provenance["notice_ids"])
        or selected_document_ids.intersection(provenance["document_ids"])
    )


def _load_target_record_provenance(
    *,
    record: DocumentRegistryRecord,
    object_store: TargetMaterializationObjectReader,
    bucket_derived: str,
) -> dict[str, set[str]]:
    notice_ids: set[str] = set()
    document_ids: set[str] = set()
    if not record.document_units_object_key:
        return {"notice_ids": notice_ids, "document_ids": document_ids}

    try:
        payload = object_store.get_bytes(
            bucket=bucket_derived,
            key=record.document_units_object_key,
        ).decode("utf-8")
    except Exception:
        return {"notice_ids": notice_ids, "document_ids": document_ids}

    for line in payload.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        metadata = row.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        notice_ids.update(_collect_values(metadata, _NOTICE_PROVENANCE_KEYS))
        document_ids.update(_collect_values(metadata, _DOCUMENT_PROVENANCE_KEYS))
        document_ids.update(_collect_values(row, ("doc_id",)))
        source_url = row.get("source_url")
        if isinstance(source_url, str) and source_url.startswith("notice:"):
            document_ids.add(source_url)

    return {"notice_ids": notice_ids, "document_ids": document_ids}


def _collect_values(mapping: Mapping[str, object], keys: Sequence[str]) -> set[str]:
    values: set[str] = set()
    for key in keys:
        values.update(_coerce_values(mapping.get(key)))
    return values


def _coerce_values(value: object) -> Iterable[str]:
    if isinstance(value, str):
        normalized = value.strip()
        return (normalized,) if normalized else ()
    if isinstance(value, (list, tuple, set)):
        return tuple(
            item for raw_item in value if isinstance(raw_item, str) and (item := raw_item.strip())
        )
    return ()


def _uri_matches_selection(
    uri: str,
    *,
    selected_notice_ids: set[str],
    selected_document_ids: set[str],
) -> bool:
    if not uri:
        return False
    if any(document_id in uri for document_id in selected_document_ids):
        return True
    return any(
        re.search(rf"(?<![A-Za-z0-9]){re.escape(notice_id)}(?![A-Za-z0-9])", uri) is not None
        for notice_id in selected_notice_ids
    )


def _normalize_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


__all__ = [
    "TargetMaterializationObjectReader",
    "replace_selected_target_scope_preserving_unselected",
]
