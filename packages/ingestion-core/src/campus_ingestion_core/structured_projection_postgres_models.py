from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StructuredProjectionReleaseRecord:
    release_id: str
    corpus: str
    collection: str
    schema_version: str
    artifact_object_key: str
    artifact_checksum: str
    generated_at: str
    published_at: str
    validation_status: str
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class _TypedColumn:
    name: str
    kind: str
    ddl: str

    @property
    def recordset_sql(self) -> str:
        if self.kind in {"text", "timestamptz"}:
            return f"{self.name} text"
        if self.kind == "integer":
            return f"{self.name} integer"
        if self.kind == "boolean":
            return f"{self.name} boolean"
        if self.kind in {"text_array", "jsonb", "jsonb_object"}:
            return f"{self.name} jsonb"
        raise ValueError(f"unsupported typed column kind: {self.kind}")

    @property
    def select_sql(self) -> str:
        if self.kind == "text":
            return f"coalesce(item.{self.name}, '') as {self.name}"
        if self.kind == "timestamptz":
            return f"nullif(item.{self.name}, '')::timestamptz as {self.name}"
        if self.kind == "integer":
            return f"coalesce(item.{self.name}, 0) as {self.name}"
        if self.kind == "boolean":
            return f"coalesce(item.{self.name}, false) as {self.name}"
        if self.kind == "jsonb":
            return f"coalesce(item.{self.name}, '[]'::jsonb) as {self.name}"
        if self.kind == "jsonb_object":
            return f"coalesce(item.{self.name}, '{{}}'::jsonb) as {self.name}"
        if self.kind == "text_array":
            alias = f"{self.name}_values"
            return (
                "coalesce(("
                f"select array_agg(value) from jsonb_array_elements_text("
                f"coalesce(item.{self.name}, '[]'::jsonb)) as {alias}(value)"
                "), '{}'::text[])"
                f" as {self.name}"
            )
        raise ValueError(f"unsupported typed column kind: {self.kind}")


_COMMON_SEARCH_COLUMN = _TypedColumn("search_text", "text", "text not null default ''")

_TYPED_TABLE_COLUMNS: dict[str, tuple[_TypedColumn, ...]] = {
    "service_guide_read_model": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("category", "text", "text not null default ''"),
        _TypedColumn("campus_scope", "text", "text not null default ''"),
        _TypedColumn("audience", "text_array", "text[] not null default '{}'"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("guide_sections", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("procedure_groups", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("materials", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("entry_refs", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("office_hours", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("contact_refs", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("eligibility_notes", "text_array", "text[] not null default '{}'"),
        _TypedColumn("field_status", "jsonb_object", "jsonb not null default '{}'::jsonb"),
        _TypedColumn("extraction_status", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "service_guide_conflicts": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
    ),
    "service_guide_manual_review_sources": (
        _TypedColumn("service_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
    ),
    "contact_directory_read_model": (
        _TypedColumn("contact_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("contact_group", "text", "text not null default ''"),
        _TypedColumn("department", "text", "text not null default ''"),
        _TypedColumn("phones", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("emails", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("location_refs", "jsonb", "jsonb not null default '[]'::jsonb"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("extraction_status", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "contact_directory_conflicts": (
        _TypedColumn("contact_id", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("reason", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "contact_directory_manual_review_sources": (
        _TypedColumn("reason", "text", "text not null default ''"),
        _TypedColumn("line", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "academic_calendar_read_model": (
        _TypedColumn("academic_year_label", "text", "text not null default ''"),
        _TypedColumn("term_label", "text", "text not null default ''"),
        _TypedColumn("start_date", "text", "text not null default ''"),
        _TypedColumn("end_date", "text", "text not null default ''"),
        _TypedColumn("week_index", "integer", "integer not null default 0"),
        _TypedColumn("day_kind", "text", "text not null default ''"),
        _TypedColumn("class_day_pattern", "text", "text not null default ''"),
        _TypedColumn("is_makeup_class", "boolean", "boolean not null default false"),
        _TypedColumn("holiday_name", "text", "text not null default ''"),
        _TypedColumn("source_refs", "text_array", "text[] not null default '{}'"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_schedule_snapshots": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("published_at", "timestamptz", "timestamptz"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("is_current", "boolean", "boolean not null default false"),
        _TypedColumn("schedule_scope", "text", "text not null default ''"),
        _TypedColumn("precedence", "integer", "integer not null default 0"),
    ),
    "transport_routes": (
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("display_name", "text", "text not null default ''"),
        _TypedColumn("service_family", "text", "text not null default ''"),
        _TypedColumn("aliases", "text_array", "text[] not null default '{}'"),
        _TypedColumn("origin_campus", "text", "text not null default ''"),
        _TypedColumn("destination_campus", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_scheduled_departures": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("service_dates", "text_array", "text[] not null default '{}'"),
        _TypedColumn("departure_time", "text", "text not null default ''"),
        _TypedColumn("arrival_time", "text", "text not null default ''"),
        _TypedColumn("origin_stop_id", "text", "text not null default ''"),
        _TypedColumn("destination_stop_id", "text", "text not null default ''"),
        _TypedColumn("related_notice_refs", "text_array", "text[] not null default '{}'"),
        _TypedColumn("operational_comment", "text", "text not null default ''"),
        _TypedColumn("departure_status", "text", "text not null default ''"),
        _TypedColumn("departure_kind", "text", "text not null default ''"),
    ),
    "transport_service_exceptions": (
        _TypedColumn("snapshot_id", "text", "text not null default ''"),
        _TypedColumn("route_id", "text", "text not null default ''"),
        _TypedColumn("service_date", "text", "text not null default ''"),
        _TypedColumn("service_status", "text", "text not null default ''"),
        _TypedColumn("related_notice_refs", "text_array", "text[] not null default '{}'"),
    ),
    "transport_operational_notices": (
        _TypedColumn("notice_id", "text", "text not null default ''"),
        _TypedColumn("notice_kind", "text", "text not null default ''"),
        _TypedColumn("route_ids", "text_array", "text[] not null default '{}'"),
        _TypedColumn("effective_from", "timestamptz", "timestamptz"),
        _TypedColumn("effective_until", "timestamptz", "timestamptz"),
        _TypedColumn("operational_comment", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_rejected_sources": (
        _TypedColumn("source_notice_id", "text", "text not null default ''"),
        _TypedColumn("reason", "text", "text not null default ''"),
        _TypedColumn("candidate_kind", "text", "text not null default ''"),
        _COMMON_SEARCH_COLUMN,
    ),
    "transport_release_notices": (
        _TypedColumn("source_notice_id", "text", "text not null default ''"),
        _TypedColumn("source_notice_release_time", "timestamptz", "timestamptz"),
        _TypedColumn("admitted_at", "timestamptz", "timestamptz"),
        _TypedColumn("materialized_at", "timestamptz", "timestamptz"),
    ),
}
