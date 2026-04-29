from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.models import DocumentRegistryRecord

DEFAULT_SERVING_STATUS = "active"


def select_releasable_registry_records(
    *,
    records: Sequence[DocumentRegistryRecord],
    runtime_profile: CollectionRuntimeProfile,
) -> tuple[DocumentRegistryRecord, ...]:
    selected = [
        record
        for record in records
        if record.status == DEFAULT_SERVING_STATUS
        and (
            not runtime_profile.serving_revision_tracks
            or record.revision_track in runtime_profile.serving_revision_tracks
        )
        and (not runtime_profile.current_only or record.is_current)
    ]
    return tuple(
        sorted(
            selected,
            key=lambda item: (item.document_id, item.revision_track, item.version_id),
        )
    )


def record_label(record: DocumentRegistryRecord) -> str:
    return f"{record.corpus}/{record.collection} {record.document_id}@{record.version_id}"


__all__ = [
    "DEFAULT_SERVING_STATUS",
    "record_label",
    "select_releasable_registry_records",
]
