from __future__ import annotations

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    ContactDirectoryEntitySelector,
    ContactDirectoryLookupPayload,
    RagRequestPayload,
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
    | ContactDirectoryLookupPayload
    | CampusNoticeDiscoverPayload
    | CampusNoticeGetPayload
    | RagRequestPayload
)


def parse_agent_payload_by_kind(payload_kind: str, payload: dict[str, object]) -> AgentPayload:
    if payload_kind == "rag_request":
        return RagRequestPayload(
            scope=parse_requested_scope(payload.get("scope")),
            version_query=parse_version_query(payload.get("version_query")),
        )
    if payload_kind == "transport_schedule_lookup":
        route_selector = payload.get("route_selector")
        service_time_query = payload.get("service_time_query")
        return TransportScheduleLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            intent=require_string(payload.get("intent"), field_name="intent"),
            route_selector=(
                None
                if route_selector is None
                else TransportRouteSelector(
                    **require_object(route_selector, field_name="route_selector")
                )
            ),
            snapshot_query=parse_temporal_query(payload.get("snapshot_query")),
            service_time_query=(
                None
                if service_time_query is None
                else TransportServiceTimeQuery(
                    **require_object(service_time_query, field_name="service_time_query")
                )
            ),
            result_limit=parse_optional_int(payload.get("result_limit")),
        )
    if payload_kind == "service_status_lookup":
        return ServiceStatusLookupPayload(
            subject_query=require_string(payload.get("subject_query"), field_name="subject_query"),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            campus_scope=parse_optional_string(payload.get("campus_scope")) or "",
        )
    if payload_kind == "contact_directory_lookup":
        entity_selector = payload.get("entity_selector")
        return ContactDirectoryLookupPayload(
            query_text=require_string(payload.get("query_text"), field_name="query_text"),
            contact_focus=require_string(payload.get("contact_focus"), field_name="contact_focus"),
            entity_selector=(
                None
                if entity_selector is None
                else ContactDirectoryEntitySelector(
                    **require_object(entity_selector, field_name="entity_selector")
                )
            ),
            temporal_query=parse_temporal_query(payload.get("temporal_query")),
            campus_scope=parse_optional_string(payload.get("campus_scope")) or "",
            audience=parse_optional_string(payload.get("audience")) or "unknown",
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
    if payload_kind == "campus_notice_get":
        return CampusNoticeGetPayload(
            notice_id=require_string(payload.get("notice_id"), field_name="notice_id"),
            source_family=parse_optional_string(payload.get("source_family")) or "",
        )
    raise ValueError(f"unsupported preplanned agent payload kind: {payload_kind}")


def parse_temporal_query(raw_query: object) -> TemporalQuery:
    if raw_query is None:
        return TemporalQuery()
    query = require_object(raw_query, field_name="temporal_query")
    return TemporalQuery(
        mode=parse_optional_string(query.get("mode")) or "current",
        as_of=parse_optional_string(query.get("as_of")) or "",
        year_hint=parse_optional_string(query.get("year_hint")) or "",
    )
