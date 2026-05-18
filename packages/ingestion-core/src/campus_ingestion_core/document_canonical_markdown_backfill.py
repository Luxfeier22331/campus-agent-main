from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_loading import load_default_structured_units
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.registry_scope_common import record_label

_CANONICAL_MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8"
_TITLE_UNIT_TYPES = frozenset({"heading", "regulation_title", "title"})


class DocumentCanonicalMarkdownBackfillObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class DocumentCanonicalMarkdownBackfillItem:
    document_id: str
    version_id: str
    canonical_markdown_object_key: str
    document_units_object_key: str
    sha256: str
    byte_size: int


@dataclass(frozen=True, slots=True)
class DocumentCanonicalMarkdownBackfillReport:
    selected_record_count: int
    backfilled_count: int
    skipped_existing_count: int
    backfilled_documents: tuple[DocumentCanonicalMarkdownBackfillItem, ...]
    skipped_existing_documents: tuple[str, ...]


def backfill_missing_canonical_markdown_from_document_units(
    *,
    bucket: str,
    object_store: DocumentCanonicalMarkdownBackfillObjectStore,
    records: tuple[DocumentRegistryRecord, ...],
) -> DocumentCanonicalMarkdownBackfillReport:
    existing_document_ids: list[str] = []
    pending: list[tuple[DocumentRegistryRecord, bytes]] = []
    for record in records:
        _assert_record_has_required_keys(record)
        canonical_key = record.canonical_markdown_object_key or ""
        if _object_exists(object_store=object_store, bucket=bucket, key=canonical_key):
            existing_document_ids.append(record.document_id)
            continue
        document_units_key = record.document_units_object_key or ""
        try:
            document_units_bytes = object_store.get_bytes(bucket=bucket, key=document_units_key)
        except (FileNotFoundError, KeyError) as exc:
            raise ValueError(
                f"document_units_object missing for {record_label(record)}: {document_units_key}"
            ) from exc
        pending.append((record, document_units_bytes))

    prepared = tuple(
        _build_backfill_payload(record=record, document_units_bytes=document_units_bytes)
        for record, document_units_bytes in pending
    )
    for record, payload in prepared:
        object_store.put_bytes(
            bucket=bucket,
            key=record.canonical_markdown_object_key or "",
            data=payload,
            content_type=_CANONICAL_MARKDOWN_CONTENT_TYPE,
        )

    return DocumentCanonicalMarkdownBackfillReport(
        selected_record_count=len(records),
        backfilled_count=len(prepared),
        skipped_existing_count=len(existing_document_ids),
        backfilled_documents=tuple(
            DocumentCanonicalMarkdownBackfillItem(
                document_id=record.document_id,
                version_id=record.version_id,
                canonical_markdown_object_key=record.canonical_markdown_object_key or "",
                document_units_object_key=record.document_units_object_key or "",
                sha256=_sha256_hex(payload),
                byte_size=len(payload),
            )
            for record, payload in prepared
        ),
        skipped_existing_documents=tuple(sorted(existing_document_ids)),
    )


def _assert_record_has_required_keys(record: DocumentRegistryRecord) -> None:
    if not str(record.document_units_object_key or "").strip():
        raise ValueError(f"document_units_object_key is required for {record_label(record)}")
    if not str(record.canonical_markdown_object_key or "").strip():
        raise ValueError(f"canonical_markdown_object_key is required for {record_label(record)}")


def _object_exists(
    *,
    object_store: DocumentCanonicalMarkdownBackfillObjectStore,
    bucket: str,
    key: str,
) -> bool:
    try:
        object_store.get_bytes(bucket=bucket, key=key)
    except (FileNotFoundError, KeyError):
        return False
    return True


def _build_backfill_payload(
    *,
    record: DocumentRegistryRecord,
    document_units_bytes: bytes,
) -> tuple[DocumentRegistryRecord, bytes]:
    units = tuple(load_default_structured_units(record, document_units_bytes))
    title = _resolve_title(record=record, units=units)
    body_units = tuple(unit for unit in units if not _is_title_unit(unit=unit, title=title))
    body_parts = tuple(_normalize_body_text(unit.text) for unit in body_units if unit.text.strip())
    if not body_parts:
        raise ValueError(f"no canonical body units for {record_label(record)}")
    payload = f"# {title}\n\n" + "\n\n".join(body_parts) + "\n"
    return record, payload.encode("utf-8")


def _resolve_title(*, record: DocumentRegistryRecord, units: tuple[StructuredUnit, ...]) -> str:
    for unit in units:
        title = str(unit.metadata.get("title") or "").strip()
        if title:
            return title
    for unit in units:
        if unit.unit_type.strip() in _TITLE_UNIT_TYPES and unit.text.strip():
            return unit.text.strip()
    raise ValueError(f"canonical title missing for {record_label(record)}")


def _is_title_unit(*, unit: StructuredUnit, title: str) -> bool:
    if unit.unit_type.strip() in _TITLE_UNIT_TYPES:
        return True
    return unit.text.strip() == title


def _normalize_body_text(value: str) -> str:
    return "\n".join(line.strip() for line in value.strip().splitlines() if line.strip())


def _sha256_hex(payload: bytes) -> str:
    import hashlib

    return hashlib.sha256(payload).hexdigest()


__all__ = [
    "DocumentCanonicalMarkdownBackfillItem",
    "DocumentCanonicalMarkdownBackfillObjectStore",
    "DocumentCanonicalMarkdownBackfillReport",
    "backfill_missing_canonical_markdown_from_document_units",
]
