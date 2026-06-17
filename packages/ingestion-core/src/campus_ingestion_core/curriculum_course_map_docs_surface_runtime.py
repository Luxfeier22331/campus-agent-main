from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Protocol

from campus_ingestion_core.artifacts import DOCUMENT_UNITS_FILENAME
from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    CurriculumCourseMapInventoryEntry,
)


class ObjectStoreByteReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class ObjectStoreAdmin(ObjectStoreByteReader, Protocol):
    def list_keys(self, *, bucket: str, prefix: str) -> list[str]: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...

    def delete_prefix(self, *, bucket: str, prefix: str) -> None: ...


def _build_object_store_from_env(source: Mapping[str, str]) -> ObjectStoreAdmin:
    from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin
    from campus_ingestion_core.settings import ObjectStoreSettings

    return S3ObjectStoreAdmin(ObjectStoreSettings.from_env(dict(source)))


def _resolve_curriculum_plan_document_units_keys(
    *,
    object_store: ObjectStoreAdmin,
    bucket: str,
) -> dict[str, str]:
    keys = object_store.list_keys(bucket=bucket, prefix="curriculum/documents/curriculum_plan/")
    resolved: dict[str, str] = {}
    for key in keys:
        if not key.endswith(f"/{DOCUMENT_UNITS_FILENAME}"):
            continue
        document_units = object_store.get_bytes(bucket=bucket, key=key)
        document_id = _parse_doc_id_from_document_units_rows(document_units)
        resolved[document_id] = key
    return resolved


def _parse_doc_id_from_document_units_rows(document_units_bytes: bytes) -> str:
    for line in document_units_bytes.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        document_id = str(payload.get("doc_id") or "").strip()
        if document_id:
            return document_id
    raise ValueError("doc_id is required in canonical document-units")


def _build_inventory_sample_id(entry: CurriculumCourseMapInventoryEntry) -> str:
    return f"course-map-p{entry.page_number:04d}-{entry.row_id}"


def _normalize_document_ids(source_document_ids: Sequence[str] | None) -> tuple[str, ...]:
    if source_document_ids is None:
        return ()
    return tuple(dict.fromkeys(document_id for document_id in source_document_ids if document_id))
