from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from campus_contracts import VersionQuery, VersionQueryMode

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry

VersionResolutionStatus = Literal["resolved", "unresolved"]
VersionResolutionReason = Literal[
    "document_not_found",
    "current_version_not_found",
    "previous_version_not_found",
    "version_not_found",
    "as_of_unresolved",
    "compare_pair_unresolved",
]
VersionSelectionAnchor = Literal["current", "previous", "exact", "as_of"]

_CHINESE_DATE_RE = re.compile(r"(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日")


@dataclass(frozen=True, slots=True)
class ResolvedVersionSelection:
    document_id: str
    revision_track: str
    version_id: str
    anchor: VersionSelectionAnchor


@dataclass(frozen=True, slots=True)
class ResolvedVersionQuery:
    mode: VersionQueryMode
    status: VersionResolutionStatus
    primary_selection: ResolvedVersionSelection | None = None
    comparison_selection: ResolvedVersionSelection | None = None
    unresolved_reason: VersionResolutionReason | str = ""

    @property
    def selected_version_ids(self) -> tuple[str, ...]:
        if self.primary_selection is None:
            return ()
        if self.comparison_selection is None:
            return (self.primary_selection.version_id,)
        if self.comparison_selection.version_id == self.primary_selection.version_id:
            return (self.primary_selection.version_id,)
        return (
            self.primary_selection.version_id,
            self.comparison_selection.version_id,
        )


def resolve_version_query(
    registry: DocumentRegistry,
    *,
    document_id: str,
    version_query: VersionQuery,
    preferred_revision_tracks: tuple[str, ...] = (),
) -> ResolvedVersionQuery:
    _, records = _resolve_track_records(
        registry,
        document_id=document_id,
        preferred_revision_tracks=preferred_revision_tracks,
    )
    if not records:
        return _unresolved(version_query.mode, "document_not_found")

    if version_query.mode == "current":
        current_record = _resolve_current_record(registry, document_id=document_id, records=records)
        if current_record is None:
            return _unresolved(version_query.mode, "current_version_not_found")
        return _resolved(
            version_query.mode,
            _selection_from_record(current_record, anchor="current"),
        )

    if version_query.mode == "historical":
        historical_record = _resolve_historical_record(
            registry,
            document_id=document_id,
            records=records,
            version_query=version_query,
        )
        if historical_record is None:
            return _unresolved(
                version_query.mode,
                "version_not_found" if version_query.version_id else "previous_version_not_found",
            )
        return _resolved(
            version_query.mode,
            _selection_from_record(
                historical_record,
                anchor="exact" if version_query.version_id else "previous",
            ),
        )

    if version_query.mode == "as_of":
        as_of_record = _resolve_as_of_record(records, as_of=version_query.as_of)
        if as_of_record is None:
            return _unresolved(version_query.mode, "as_of_unresolved")
        return _resolved(
            version_query.mode,
            _selection_from_record(as_of_record, anchor="as_of"),
        )

    current_record = _resolve_current_record(registry, document_id=document_id, records=records)
    primary_record = _resolve_historical_record(
        registry,
        document_id=document_id,
        records=records,
        version_query=version_query,
    )
    comparison_record = (
        _resolve_exact_record(records, version_query.compare_to_version_id)
        if version_query.compare_to_version_id
        else current_record
    )
    if (
        current_record is None
        or primary_record is None
        or comparison_record is None
        or comparison_record.version_id == primary_record.version_id
    ):
        return _unresolved(version_query.mode, "compare_pair_unresolved")
    return ResolvedVersionQuery(
        mode=version_query.mode,
        status="resolved",
        primary_selection=_selection_from_record(
            primary_record,
            anchor="exact" if version_query.version_id else "previous",
        ),
        comparison_selection=_selection_from_record(
            comparison_record,
            anchor="exact" if version_query.compare_to_version_id else "current",
        ),
    )


def _resolve_track_records(
    registry: DocumentRegistry,
    *,
    document_id: str,
    preferred_revision_tracks: tuple[str, ...],
) -> tuple[str, tuple[DocumentRegistryRecord, ...]]:
    for revision_track in preferred_revision_tracks:
        records = registry.list_versions(document_id, revision_track)
        if records:
            return revision_track, records
    current_record = registry.current_version(
        document_id,
        preferred_revision_tracks=preferred_revision_tracks,
    )
    if current_record is not None:
        records = registry.list_versions(document_id, current_record.revision_track)
        if records:
            return current_record.revision_track, records
    records = registry.list_versions(document_id)
    if not records:
        return "", ()
    fallback_revision_track = records[0].revision_track
    return fallback_revision_track, registry.list_versions(document_id, fallback_revision_track)


def _resolve_current_record(
    registry: DocumentRegistry,
    *,
    document_id: str,
    records: tuple[DocumentRegistryRecord, ...],
) -> DocumentRegistryRecord | None:
    current_record = registry.current_version(
        document_id,
        preferred_revision_tracks=(records[0].revision_track,),
    )
    if current_record is not None:
        return current_record
    for record in records:
        if record.is_current:
            return record
    return None


def _resolve_historical_record(
    registry: DocumentRegistry,
    *,
    document_id: str,
    records: tuple[DocumentRegistryRecord, ...],
    version_query: VersionQuery,
) -> DocumentRegistryRecord | None:
    if version_query.version_id:
        exact_record = _resolve_exact_record(records, version_query.version_id)
        if exact_record is None or exact_record.is_current:
            return None
        return exact_record
    current_record = _resolve_current_record(registry, document_id=document_id, records=records)
    if current_record is not None and current_record.supersedes_version_id:
        superseded_record = _resolve_exact_record(records, current_record.supersedes_version_id)
        if superseded_record is not None:
            return superseded_record
    for record in records:
        if not record.is_current:
            return record
    return None


def _resolve_as_of_record(
    records: tuple[DocumentRegistryRecord, ...],
    *,
    as_of: str,
) -> DocumentRegistryRecord | None:
    anchor_date = _parse_date(as_of)
    if anchor_date is None:
        return None
    candidates: list[tuple[date, datetime, DocumentRegistryRecord]] = []
    for record in records:
        record_date = _record_effective_date(record)
        if record_date is None or record_date > anchor_date:
            continue
        candidates.append((record_date, _parse_timestamp(record.ingestion_timestamp), record))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return candidates[0][2]


def _resolve_exact_record(
    records: tuple[DocumentRegistryRecord, ...],
    version_id: str,
) -> DocumentRegistryRecord | None:
    for record in records:
        if record.version_id == version_id:
            return record
    return None


def _selection_from_record(
    record: DocumentRegistryRecord,
    *,
    anchor: VersionSelectionAnchor,
) -> ResolvedVersionSelection:
    return ResolvedVersionSelection(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        anchor=anchor,
    )


def _record_effective_date(record: DocumentRegistryRecord) -> date | None:
    for value in (record.effective_date, record.published_date, record.ingestion_timestamp):
        parsed = _parse_date(value)
        if parsed is not None:
            return parsed
    return None


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) >= 10 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized[:10]):
        try:
            return date.fromisoformat(normalized[:10])
        except ValueError:
            return None
    match = _CHINESE_DATE_RE.match(normalized)
    if match is not None:
        return date(
            int(match.group("year")),
            int(match.group("month")),
            int(match.group("day")),
        )
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _resolved(
    mode: VersionQueryMode,
    selection: ResolvedVersionSelection,
) -> ResolvedVersionQuery:
    return ResolvedVersionQuery(
        mode=mode,
        status="resolved",
        primary_selection=selection,
    )


def _unresolved(
    mode: VersionQueryMode,
    reason: VersionResolutionReason,
) -> ResolvedVersionQuery:
    return ResolvedVersionQuery(
        mode=mode,
        status="unresolved",
        unresolved_reason=reason,
    )


__all__ = [
    "ResolvedVersionQuery",
    "ResolvedVersionSelection",
    "resolve_version_query",
]
