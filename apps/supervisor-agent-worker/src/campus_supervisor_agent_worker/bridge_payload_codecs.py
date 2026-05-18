from __future__ import annotations

from campus_contracts import (
    AcademicCalendarLookupPayload,
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    ContactDirectoryEntitySelector,
    ContactDirectoryLookupPayload,
    PlaceLookupPayload,
    RagRequestPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TemporalQuery,
    TransportRouteSelector,
    TransportScheduleLookupPayload,
    TransportServiceTimeQuery,
)

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_int,
    parse_optional_string,
    parse_string_tuple,
    require_object,
    require_string,
)
from campus_supervisor_agent_worker.bridge_trace_codecs import (
    parse_requested_scope,
    parse_version_query,
)

AgentPayload = (
    TransportScheduleLookupPayload
    | ServiceStatusLookupPayload
    | ServiceGuideLookupPayload
    | ContactDirectoryLookupPayload
    | AcademicCalendarLookupPayload
    | CampusNoticeDiscoverPayload
    | CampusNoticeChangeSetLookupPayload
    | CampusNoticeGetPayload
    | RagRequestPayload
)


def parse_agent_payload_by_kind(payload_kind: str, payload: dict[str, object]) -> AgentPayload:
    if payload_kind == "rag_request":
        return RagRequestPayload(
            scope=parse_requested_scope(payload.get("scope")),
            version_query=parse_version_query(payload.get("version_query")),
        )
    if payload_kind == "place_lookup":
        return PlaceLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
        )
    if payload_kind == "academic_calendar_lookup":
        return AcademicCalendarLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            academic_year_label=parse_optional_string(
                payload.get("academic_year_label"),
                field_name="academic_year_label",
            )
            or "",
            date_hint=parse_optional_string(payload.get("date_hint"), field_name="date_hint") or "",
            query_kind=require_string(payload.get("query_kind"), field_name="query_kind"),
            event_query=parse_optional_string(payload.get("event_query"), field_name="event_query")
            or "",
            target_date=parse_optional_string(payload.get("target_date"), field_name="target_date")
            or "",
            audience=parse_optional_string(payload.get("audience"), field_name="audience") or "",
            term_label=parse_optional_string(payload.get("term_label"), field_name="term_label")
            or "",
        )
    if payload_kind == "transport_schedule_lookup":
        route_selector = payload.get("route_selector")
        service_time_query = payload.get("service_time_query")
        return TransportScheduleLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            intent=require_string(payload.get("intent"), field_name="intent"),
            route_selector=parse_transport_route_selector(route_selector),
            snapshot_query=parse_temporal_query(payload.get("snapshot_query")),
            service_time_query=parse_transport_service_time_query(service_time_query),
            result_limit=parse_optional_int(payload.get("result_limit")),
        )
    if payload_kind == "service_status_lookup":
        return ServiceStatusLookupPayload(
            subject_query=require_string(payload.get("subject_query"), field_name="subject_query"),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            campus_scope=parse_optional_string(
                payload.get("campus_scope"), field_name="campus_scope"
            )
            or "",
        )
    if payload_kind == "service_guide_lookup":
        return ServiceGuideLookupPayload(
            service_query=require_string(payload.get("service_query"), field_name="service_query"),
            guide_focus=require_string(payload.get("guide_focus"), field_name="guide_focus"),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            campus_scope=parse_optional_string(
                payload.get("campus_scope"), field_name="campus_scope"
            )
            or "",
            audience=require_string(payload.get("audience"), field_name="audience"),
            result_limit=parse_optional_int(payload.get("result_limit")),
        )
    if payload_kind == "contact_directory_lookup":
        entity_selector = payload.get("entity_selector")
        return ContactDirectoryLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            contact_focus=require_string(payload.get("contact_focus"), field_name="contact_focus"),
            entity_selector=parse_contact_directory_entity_selector(entity_selector),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            campus_scope=parse_optional_string(
                payload.get("campus_scope"), field_name="campus_scope"
            )
            or "",
            audience=require_string(payload.get("audience"), field_name="audience"),
            result_limit=parse_optional_int(payload.get("result_limit")),
        )
    if payload_kind == "campus_notice_discover":
        return CampusNoticeDiscoverPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            source_families=parse_string_tuple(
                payload.get("source_families"),
                field_name="source_families",
            ),
            target_surfaces=parse_string_tuple(
                payload.get("target_surfaces"),
                field_name="target_surfaces",
            ),
            max_results=parse_optional_int(payload.get("max_results")) or 5,
        )
    if payload_kind == "campus_notice_change_set_lookup":
        return CampusNoticeChangeSetLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            route_labels=parse_string_tuple(
                payload.get("route_labels"),
                field_name="route_labels",
            ),
            direction_labels=parse_string_tuple(
                payload.get("direction_labels"),
                field_name="direction_labels",
            ),
            stop_labels=parse_string_tuple(
                payload.get("stop_labels"),
                field_name="stop_labels",
            ),
            service_date=parse_optional_string(
                payload.get("service_date"),
                field_name="service_date",
            )
            or "",
            query_time_anchor=parse_optional_string(
                payload.get("query_time_anchor"),
                field_name="query_time_anchor",
            )
            or "",
        )
    if payload_kind == "campus_notice_get":
        return CampusNoticeGetPayload(
            notice_id=require_string(payload.get("notice_id"), field_name="notice_id"),
            source_family=parse_optional_string(
                payload.get("source_family"), field_name="source_family"
            )
            or "",
        )
    raise ValueError(f"unsupported preplanned agent payload kind: {payload_kind}")


def parse_transport_route_selector(raw_selector: object) -> TransportRouteSelector | None:
    if raw_selector is None:
        return None
    selector = require_object(raw_selector, field_name="route_selector")
    _assert_supported_fields(
        selector,
        field_name="route_selector",
        supported_fields=(
            "route_id",
            "service_family",
            "route_variant_query",
            "origin_campus",
            "destination_campus",
            "origin_stop_query",
            "destination_stop_query",
        ),
    )
    return TransportRouteSelector(
        route_id=_normalize_optional_string_field(
            selector.get("route_id"),
            field_name="route_selector.route_id",
        ),
        service_family=_normalize_optional_string_field(
            selector.get("service_family"),
            field_name="route_selector.service_family",
        ),
        route_variant_query=_normalize_optional_string_field(
            selector.get("route_variant_query"),
            field_name="route_selector.route_variant_query",
        ),
        origin_campus=_normalize_optional_string_field(
            selector.get("origin_campus"),
            field_name="route_selector.origin_campus",
        ),
        destination_campus=_normalize_optional_string_field(
            selector.get("destination_campus"),
            field_name="route_selector.destination_campus",
        ),
        origin_stop_query=_normalize_optional_string_field(
            selector.get("origin_stop_query"),
            field_name="route_selector.origin_stop_query",
        ),
        destination_stop_query=_normalize_optional_string_field(
            selector.get("destination_stop_query"),
            field_name="route_selector.destination_stop_query",
        ),
    )


def parse_transport_service_time_query(raw_query: object) -> TransportServiceTimeQuery | None:
    if raw_query is None:
        return None
    query = require_object(raw_query, field_name="service_time_query")
    _assert_supported_fields(
        query,
        field_name="service_time_query",
        supported_fields=(
            "date_mode",
            "service_date",
            "daypart",
            "departure_not_before",
            "departure_not_after",
        ),
    )
    return TransportServiceTimeQuery(
        date_mode=_normalize_optional_string_field(
            query.get("date_mode"),
            field_name="service_time_query.date_mode",
            default="today",
        ),
        service_date=_normalize_optional_string_field(
            query.get("service_date"),
            field_name="service_time_query.service_date",
        ),
        daypart=_normalize_optional_string_field(
            query.get("daypart"),
            field_name="service_time_query.daypart",
            default="all_day",
        ),
        departure_not_before=_normalize_optional_string_field(
            query.get("departure_not_before"),
            field_name="service_time_query.departure_not_before",
        ),
        departure_not_after=_normalize_optional_string_field(
            query.get("departure_not_after"),
            field_name="service_time_query.departure_not_after",
        ),
    )


def parse_contact_directory_entity_selector(
    raw_selector: object,
) -> ContactDirectoryEntitySelector | None:
    if raw_selector is None:
        return None
    selector = require_object(raw_selector, field_name="entity_selector")
    _assert_supported_fields(
        selector,
        field_name="entity_selector",
        supported_fields=(
            "contact_id",
            "department_query",
            "office_query",
            "service_query",
            "person_query",
            "role_query",
            "purpose_query",
            "contact_group_query",
            "location_query",
        ),
    )
    return ContactDirectoryEntitySelector(
        contact_id=parse_optional_string(
            selector.get("contact_id"),
            field_name="entity_selector.contact_id",
        )
        or "",
        department_query=parse_optional_string(
            selector.get("department_query"),
            field_name="entity_selector.department_query",
        )
        or "",
        office_query=parse_optional_string(
            selector.get("office_query"),
            field_name="entity_selector.office_query",
        )
        or "",
        service_query=parse_optional_string(
            selector.get("service_query"),
            field_name="entity_selector.service_query",
        )
        or "",
        person_query=parse_optional_string(
            selector.get("person_query"),
            field_name="entity_selector.person_query",
        )
        or "",
        role_query=parse_optional_string(
            selector.get("role_query"),
            field_name="entity_selector.role_query",
        )
        or "",
        purpose_query=parse_optional_string(
            selector.get("purpose_query"),
            field_name="entity_selector.purpose_query",
        )
        or "",
        contact_group_query=parse_optional_string(
            selector.get("contact_group_query"),
            field_name="entity_selector.contact_group_query",
        )
        or "",
        location_query=parse_optional_string(
            selector.get("location_query"),
            field_name="entity_selector.location_query",
        )
        or "",
    )


def parse_temporal_query(raw_query: object) -> TemporalQuery:
    if raw_query is None:
        return TemporalQuery()
    query = require_object(raw_query, field_name="temporal_query")
    _assert_supported_fields(
        query,
        field_name="temporal_query",
        supported_fields=("mode", "as_of", "year_hint"),
    )
    return TemporalQuery(
        mode=_normalize_optional_string_field(
            query.get("mode"),
            field_name="temporal_query.mode",
            default="current",
        ),
        as_of=_normalize_optional_string_field(
            query.get("as_of"),
            field_name="temporal_query.as_of",
        ),
        year_hint=_normalize_optional_string_field(
            query.get("year_hint"),
            field_name="temporal_query.year_hint",
        ),
    )


def _normalize_optional_string_field(
    raw_value: object,
    *,
    field_name: str,
    default: str = "",
) -> str:
    normalized = parse_optional_string(raw_value, field_name=field_name)
    if normalized is None:
        return default
    return normalized


def _assert_supported_fields(
    payload: dict[str, object],
    *,
    field_name: str,
    supported_fields: tuple[str, ...],
) -> None:
    supported = set(supported_fields)
    unsupported = sorted(field for field in payload if field not in supported)
    if unsupported:
        joined = ", ".join(f"{field_name}.{field}" for field in unsupported)
        raise ValueError(f"unsupported {field_name} fields are not allowed: {joined}")
