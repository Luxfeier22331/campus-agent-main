from __future__ import annotations

from dataclasses import replace
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord


class _ScopedDocumentProtocol(Protocol):
    corpus: str
    collection: str
    document_id: str
    revision_track: str
    version_id: str
    is_current: bool
    ingestion_timestamp: str


def prefetch_existing_scope_records(
    *,
    registry: object,
    scope: tuple[str, str],
    scope_refresh: tuple[str, str] | None,
) -> tuple[DocumentRegistryRecord, ...]:
    list_importable_scope_records = getattr(
        registry, "list_importable_scope_records_by_scope", None
    )
    if callable(list_importable_scope_records):
        return tuple(list_importable_scope_records(scope[0], scope[1]))
    return registry.list_by_scope(scope[0], scope[1])


def group_documents_by_scope(
    documents: list[_ScopedDocumentProtocol],
) -> dict[tuple[str, str], tuple[_ScopedDocumentProtocol, ...]]:
    grouped: dict[tuple[str, str], list[_ScopedDocumentProtocol]] = {}
    for document in documents:
        grouped.setdefault((document.corpus, document.collection), []).append(document)
    return {scope: tuple(scope_documents) for scope, scope_documents in grouped.items()}


def index_scope_records_by_lineage(
    records: tuple[DocumentRegistryRecord, ...],
) -> dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]]:
    indexed: dict[tuple[str, str], list[DocumentRegistryRecord]] = {}
    for record in records:
        indexed.setdefault((record.document_id, record.revision_track), []).append(record)
    return {lineage: tuple(lineage_records) for lineage, lineage_records in indexed.items()}


def record_scope_refresh_candidate(
    *,
    scope_records_for_refresh: dict[
        tuple[str, str], dict[tuple[str, str, str], DocumentRegistryRecord]
    ],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> None:
    scope_records_for_refresh.setdefault(scope, {})[
        (record.document_id, record.revision_track, record.version_id)
    ] = record


def apply_current_promotion(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> tuple[DocumentRegistryRecord, tuple[DocumentRegistryRecord, ...]]:
    if not record.is_current:
        return record, ()
    lineage_records = existing_records_by_lineage.get(scope, {}).get(
        (record.document_id, record.revision_track), ()
    )
    prior_current_records = tuple(
        candidate
        for candidate in lineage_records
        if candidate.version_id != record.version_id and candidate.is_current
    )
    promoted_record = record
    if prior_current_records and record.supersedes_version_id is None:
        latest_prior_current = max(
            prior_current_records, key=lambda candidate: candidate.ingestion_timestamp
        )
        promoted_record = replace(record, supersedes_version_id=latest_prior_current.version_id)
    demoted_records = tuple(
        replace(
            candidate,
            is_current=False,
            status="superseded" if candidate.status == "active" else candidate.status,
        )
        for candidate in prior_current_records
    )
    return promoted_record, demoted_records


def replace_prefetched_lineage_record(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    record: DocumentRegistryRecord,
) -> None:
    lineage_key = (record.document_id, record.revision_track)
    lineage_records = {
        candidate.version_id: candidate
        for candidate in existing_records_by_lineage.setdefault(scope, {}).get(lineage_key, ())
    }
    lineage_records[record.version_id] = record
    existing_records_by_lineage[scope][lineage_key] = tuple(lineage_records.values())


def write_registry_records(
    *,
    registry: object,
    records: tuple[DocumentRegistryRecord, ...],
) -> None:
    if not records:
        return
    upsert_many = getattr(registry, "upsert_many", None)
    if callable(upsert_many):
        upsert_many(records)
        return
    for record in records:
        registry.upsert(record)
