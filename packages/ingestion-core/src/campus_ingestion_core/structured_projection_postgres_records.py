from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.structured_projection_postgres_models import (
    _TYPED_TABLE_COLUMNS,
    StructuredProjectionReleaseRecord,
    _TypedColumn,
)


def _typed_recordsets(
    *,
    collection: str,
    release_id: str,
    bundle: Mapping[str, Any],
) -> tuple[tuple[str, list[dict[str, Any]]], ...]:
    if collection == "transport_schedule":
        return (
            (
                "transport_schedule_snapshots",
                _records(
                    release_id,
                    bundle.get("transport_schedule_snapshots"),
                    id_fields=("snapshot_id",),
                    source_ref_field="source_ref",
                    table_name="transport_schedule_snapshots",
                ),
            ),
            (
                "transport_routes",
                _records(
                    release_id,
                    bundle.get("transport_routes"),
                    id_fields=("route_id",),
                    table_name="transport_routes",
                ),
            ),
            (
                "transport_scheduled_departures",
                _records(
                    release_id,
                    bundle.get("scheduled_departures"),
                    id_fields=("snapshot_id", "route_id", "departure_time", "service_dates"),
                    source_ref_field="related_notice_refs",
                    table_name="transport_scheduled_departures",
                ),
            ),
            (
                "transport_service_exceptions",
                _records(
                    release_id,
                    bundle.get("transport_service_exceptions"),
                    id_fields=("snapshot_id", "route_id", "service_date"),
                    source_ref_field="related_notice_refs",
                    table_name="transport_service_exceptions",
                ),
            ),
            (
                "transport_operational_notices",
                _records(
                    release_id,
                    bundle.get("transport_operational_notices"),
                    id_fields=("notice_id", "notice_kind", "route_ids"),
                    source_ref_field="source_ref",
                    table_name="transport_operational_notices",
                ),
            ),
            (
                "transport_rejected_sources",
                _records(
                    release_id,
                    bundle.get("transport_rejected_sources"),
                    id_fields=("source_notice_id", "reason"),
                    source_ref_field="source_ref",
                    table_name="transport_rejected_sources",
                ),
            ),
            (
                "transport_release_notices",
                _transport_release_notice_records(release_id=release_id, bundle=bundle),
            ),
        )
    if collection == "service_guide":
        return (
            (
                "service_guide_read_model",
                _records(
                    release_id,
                    bundle.get("service_guide_records"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_read_model",
                ),
            ),
            (
                "service_guide_conflicts",
                _records(
                    release_id,
                    bundle.get("conflict_records"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_conflicts",
                ),
            ),
            (
                "service_guide_manual_review_sources",
                _records(
                    release_id,
                    bundle.get("manual_review_sources"),
                    id_fields=("service_id",),
                    source_ref_field="source_refs",
                    table_name="service_guide_manual_review_sources",
                ),
            ),
        )
    if collection == "contact_directory":
        return (
            (
                "contact_directory_read_model",
                _records(
                    release_id,
                    bundle.get("contact_records"),
                    id_fields=("contact_id",),
                    source_ref_field="source_refs",
                    table_name="contact_directory_read_model",
                ),
            ),
            (
                "contact_directory_conflicts",
                _records(
                    release_id,
                    bundle.get("conflict_records"),
                    id_fields=("contact_id", "reason"),
                    source_ref_field="source_refs",
                    table_name="contact_directory_conflicts",
                ),
            ),
            (
                "contact_directory_manual_review_sources",
                _records(
                    release_id,
                    bundle.get("manual_review_sources"),
                    id_fields=("source_ref", "reason", "line"),
                    source_ref_field="source_ref",
                    table_name="contact_directory_manual_review_sources",
                ),
            ),
        )
    if collection == "academic_calendar":
        return (
            (
                "academic_calendar_read_model",
                _records(
                    release_id,
                    bundle.get("academic_calendar_records"),
                    id_fields=(
                        "academic_year_label",
                        "term_label",
                        "start_date",
                        "end_date",
                        "day_kind",
                    ),
                    source_ref_field="source_refs",
                    table_name="academic_calendar_read_model",
                ),
            ),
        )
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _records(
    release_id: str,
    raw_rows: object,
    *,
    id_fields: Sequence[str],
    source_ref_field: str = "",
    table_name: str,
) -> list[dict[str, Any]]:
    rows = raw_rows if isinstance(raw_rows, list) else []
    records: list[dict[str, Any]] = []
    for index, raw_row in enumerate(rows):
        if not isinstance(raw_row, Mapping):
            continue
        row = dict(raw_row)
        record_id = _record_id(row, id_fields=id_fields, generated_index=index)
        records.append(_record_payload(release_id, record_id, row, source_ref_field, table_name))
    return records


def _transport_release_notice_records(
    *,
    release_id: str,
    bundle: Mapping[str, Any],
) -> list[dict[str, Any]]:
    explicit_rows = _list(bundle.get("transport_release_notices"))
    if explicit_rows:
        return _records(
            release_id,
            explicit_rows,
            id_fields=("source_notice_id",),
            source_ref_field="source_ref",
            table_name="transport_release_notices",
        )
    return [
        _record_payload(
            release_id,
            notice_ref,
            {
                "source_notice_id": notice_ref.split(":")[-1],
                "source_ref": notice_ref,
            },
            "source_ref",
            "transport_release_notices",
        )
        for notice_ref in _source_notice_ids(bundle)
    ]


def _record_payload(
    release_id: str,
    record_id: str,
    row: Mapping[str, Any],
    source_ref_field: str,
    table_name: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "release_id": release_id,
        "record_id": record_id,
        "source_ref": _source_ref(row, source_ref_field),
        "record": dict(row),
    }
    for column in _typed_columns(table_name):
        if column.name == "search_text":
            payload[column.name] = _search_text(row)
        else:
            payload[column.name] = row.get(column.name)
    return payload


def _record_id(row: Mapping[str, Any], *, id_fields: Sequence[str], generated_index: int) -> str:
    parts: list[str] = []
    for field in id_fields:
        value = row.get(field)
        if isinstance(value, list):
            parts.append(",".join(str(item) for item in value))
        else:
            parts.append(str(value or ""))
    normalized = "|".join(part for part in parts if part)
    return normalized or f"record-{generated_index}"


def _source_ref(row: Mapping[str, Any], field: str) -> str:
    if not field:
        return ""
    value = row.get(field)
    if isinstance(value, str):
        return value
    if isinstance(value, Sequence):
        for item in value:
            text = str(item).strip()
            if text:
                return text
    return ""


def _projection_counts(collection: str, bundle: Mapping[str, Any]) -> dict[str, int]:
    if collection == "transport_schedule":
        return {
            "snapshots": len(_list(bundle.get("transport_schedule_snapshots"))),
            "routes": len(_list(bundle.get("transport_routes"))),
            "scheduled_departures": len(_list(bundle.get("scheduled_departures"))),
            "service_exceptions": len(_list(bundle.get("transport_service_exceptions"))),
            "operational_notices": len(_list(bundle.get("transport_operational_notices"))),
            "rejected_sources": len(_list(bundle.get("transport_rejected_sources"))),
        }
    if collection == "service_guide":
        return {
            "service_guide_records": len(_list(bundle.get("service_guide_records"))),
            "conflict_records": len(_list(bundle.get("conflict_records"))),
            "manual_review_sources": len(_list(bundle.get("manual_review_sources"))),
        }
    if collection == "contact_directory":
        return {
            "contact_records": len(_list(bundle.get("contact_records"))),
            "conflict_records": len(_list(bundle.get("conflict_records"))),
            "manual_review_sources": len(_list(bundle.get("manual_review_sources"))),
        }
    if collection == "academic_calendar":
        return {
            "academic_calendar_records": len(_list(bundle.get("academic_calendar_records"))),
        }
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _collection_table_names(collection: str) -> tuple[str, ...]:
    if collection == "transport_schedule":
        return (
            "transport_schedule_snapshots",
            "transport_routes",
            "transport_scheduled_departures",
            "transport_service_exceptions",
            "transport_operational_notices",
            "transport_rejected_sources",
            "transport_release_notices",
        )
    if collection == "service_guide":
        return (
            "service_guide_read_model",
            "service_guide_conflicts",
            "service_guide_manual_review_sources",
        )
    if collection == "contact_directory":
        return (
            "contact_directory_read_model",
            "contact_directory_conflicts",
            "contact_directory_manual_review_sources",
        )
    if collection == "academic_calendar":
        return ("academic_calendar_read_model",)
    raise ValueError(f"unsupported structured projection collection: {collection}")


def _source_notice_ids(bundle: Mapping[str, Any]) -> list[str]:
    values: set[str] = set()
    for row_group in (
        bundle.get("transport_schedule_snapshots"),
        bundle.get("scheduled_departures"),
        bundle.get("transport_service_exceptions"),
        bundle.get("transport_operational_notices"),
        bundle.get("transport_rejected_sources"),
        bundle.get("transport_release_notices"),
        bundle.get("service_guide_records"),
    ):
        for row in _list(row_group):
            if not isinstance(row, Mapping):
                continue
            for field in (
                "source_ref",
                "source_refs",
                "related_notice_refs",
                "source_notice_id",
                "notice_id",
            ):
                value = row.get(field)
                refs: Sequence[object]
                if isinstance(value, str):
                    refs = (value,)
                elif isinstance(value, Sequence):
                    refs = value
                else:
                    refs = ()
                for ref in refs:
                    text = str(ref).strip()
                    if text.startswith("notice:"):
                        values.add(text)
                    elif field in {"source_notice_id", "notice_id"} and text:
                        values.add(f"notice:muc_internal_portal:{text}")
    return sorted(values)


def _read_model_table_names() -> tuple[str, ...]:
    return tuple(_TYPED_TABLE_COLUMNS)


def _normalize_bootstrap_collections(
    collections: Sequence[str] | None,
) -> tuple[str, ...] | None:
    if collections is None:
        return None
    normalized = []
    seen: set[str] = set()
    for collection in collections:
        value = _required_text(collection, "bootstrap_collection")
        _collection_table_names(value)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return tuple(normalized)


def _bootstrap_table_names(collections: Sequence[str] | None) -> tuple[str, ...]:
    base = ("structured_projection_releases", "structured_projection_current")
    if collections is None:
        return base + _read_model_table_names()
    table_names: list[str] = list(base)
    seen = set(table_names)
    for collection in collections:
        for table_name in _collection_table_names(collection):
            if table_name in seen:
                continue
            seen.add(table_name)
            table_names.append(table_name)
    return tuple(table_names)


def _bootstrap_read_model_table_names(collections: Sequence[str] | None) -> tuple[str, ...]:
    if collections is None:
        return _read_model_table_names()
    table_names: list[str] = []
    seen: set[str] = set()
    for collection in collections:
        for table_name in _collection_table_names(collection):
            if table_name in seen:
                continue
            seen.add(table_name)
            table_names.append(table_name)
    return tuple(table_names)


def _typed_columns(table_name: str) -> tuple[_TypedColumn, ...]:
    return _TYPED_TABLE_COLUMNS.get(table_name, ())


def _has_typed_column(table_name: str, column_name: str) -> bool:
    return any(column.name == column_name for column in _typed_columns(table_name))


def _search_text(row: Mapping[str, Any]) -> str:
    values: list[str] = []
    for value in row.values():
        _append_search_text(values, value)
    return " ".join(value for value in values if value)


def _append_search_text(values: list[str], value: object) -> None:
    if isinstance(value, str):
        text = value.strip()
        if text:
            values.append(text)
    elif isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        for item in value:
            _append_search_text(values, item)
    elif isinstance(value, Mapping):
        for item in value.values():
            _append_search_text(values, item)


def _list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _release_record_from_row(row: Sequence[object]) -> StructuredProjectionReleaseRecord:
    counts = row[9] if len(row) > 9 else {}
    if isinstance(counts, str):
        parsed_counts = json.loads(counts)
    elif isinstance(counts, Mapping):
        parsed_counts = dict(counts)
    else:
        parsed_counts = {}
    return StructuredProjectionReleaseRecord(
        release_id=str(row[0]),
        corpus=str(row[1]),
        collection=str(row[2]),
        schema_version=str(row[3]),
        artifact_object_key=str(row[4]),
        artifact_checksum=str(row[5]),
        generated_at=str(row[6]),
        published_at=str(row[7]),
        validation_status=str(row[8]),
        counts={str(key): int(value) for key, value in parsed_counts.items()},
    )


def _normalize_identifier(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized.replace("_", "a").isalnum() or normalized[0].isdigit():
        raise ValueError(f"{field_name} must be a SQL identifier")
    return normalized


__all__ = [
    "_bootstrap_read_model_table_names",
    "_bootstrap_table_names",
    "_collection_table_names",
    "_has_typed_column",
    "_normalize_bootstrap_collections",
    "_normalize_identifier",
    "_projection_counts",
    "_read_model_table_names",
    "_release_record_from_row",
    "_required_text",
    "_source_notice_ids",
    "_typed_columns",
    "_typed_recordsets",
]
