from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict
from typing import get_args, get_origin, get_type_hints

from campus_contracts import (
    AcademicCalendarLookupPayload,
    ContactDirectoryLookupPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TransportScheduleLookupPayload,
)

from campus_services_agent.query_service import (
    AcademicCalendarQuery,
    CampusServicesAccessContext,
    CampusServicesQueryService,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)


def execute_campus_services_sdk_tool(
    execution,
    *,
    agent_request,
    query_service: CampusServicesQueryService,
) -> dict[str, object]:
    if execution.name == "service_status_lookup":
        payload = ServiceStatusLookupPayload(
            **_normalize_dataclass_arguments(ServiceStatusLookupPayload, execution.arguments)
        )
        result = query_service.lookup_service_status(
            ServiceStatusQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="subject_query",
            query_value=result.subject_query,
        )
    if execution.name == "service_guide_lookup":
        payload = ServiceGuideLookupPayload(
            **_normalize_dataclass_arguments(ServiceGuideLookupPayload, execution.arguments)
        )
        result = query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="service_query",
            query_value=result.service_query,
        )
    if execution.name == "transport_schedule_lookup":
        payload = TransportScheduleLookupPayload(
            **_normalize_dataclass_arguments(
                TransportScheduleLookupPayload,
                execution.arguments,
            )
        )
        result = query_service.lookup_transport_schedule(
            TransportScheduleQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="query_text",
            query_value=result.query_text,
        )
    if execution.name == "contact_directory_lookup":
        payload = ContactDirectoryLookupPayload(
            **_normalize_dataclass_arguments(
                ContactDirectoryLookupPayload,
                execution.arguments,
            )
        )
        result = query_service.lookup_contact_directory(
            ContactDirectoryQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="query_text",
            query_value=result.query_text,
        )
    if execution.name == "academic_calendar_lookup":
        payload = AcademicCalendarLookupPayload(
            **_normalize_dataclass_arguments(
                AcademicCalendarLookupPayload,
                execution.arguments,
            )
        )
        result = query_service.lookup_academic_calendar(
            AcademicCalendarQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="query_text",
            query_value=result.query_text,
        )
    raise ValueError(f"campus-services-agent cannot execute SDK tool: {execution.name}")


def _normalize_dataclass_arguments(
    payload_class: type[object], arguments: dict[str, object]
) -> dict[str, object]:
    normalized = dict(arguments)
    resolved_types = get_type_hints(payload_class, include_extras=True)
    for field_name, annotation in resolved_types.items():
        value = normalized.get(field_name)
        if not isinstance(value, dict):
            continue
        nested_type = _dataclass_type_for_annotation(annotation)
        if nested_type is None:
            continue
        normalized[field_name] = nested_type(
            **_normalize_nested_dataclass_arguments(nested_type, value)
        )
    return normalized


def _normalize_nested_dataclass_arguments(
    payload_class: type[object],
    arguments: dict[str, object],
) -> dict[str, object]:
    normalized = dict(arguments)
    resolved_types = get_type_hints(payload_class, include_extras=True)
    for field_name, annotation in resolved_types.items():
        value = normalized.get(field_name)
        if value is None:
            default_value = _nested_dataclass_default_value(payload_class, field_name)
            if default_value is not _MISSING:
                normalized[field_name] = default_value
            continue
        if not isinstance(value, dict):
            continue
        nested_type = _dataclass_type_for_annotation(annotation)
        if nested_type is None:
            continue
        normalized[field_name] = nested_type(
            **_normalize_nested_dataclass_arguments(nested_type, value)
        )
    return normalized


def _access_context_from_request(agent_request) -> CampusServicesAccessContext:
    return CampusServicesAccessContext(
        actor=agent_request.actor,
        authorization=agent_request.context.authorization,
    )


def _dataclass_type_for_annotation(annotation: object) -> type[object] | None:
    if isinstance(annotation, type):
        return annotation
    origin = get_origin(annotation)
    if origin is None:
        return None
    for candidate in get_args(annotation):
        if isinstance(candidate, type):
            return candidate
    return None


def _nested_dataclass_default_value(payload_class: type[object], field_name: str) -> object:
    from dataclasses import MISSING, fields

    for field in fields(payload_class):
        if field.name != field_name:
            continue
        if field.default is not MISSING:
            return field.default
        if field.default_factory is not MISSING:  # type: ignore[truthy-function]
            return field.default_factory()
        return _MISSING
    return _MISSING


class _MissingType:
    pass


_MISSING = _MissingType()


def _bounded_sdk_tool_result(
    result: object,
    *,
    query_key: str,
    query_value: str,
) -> dict[str, object]:
    payload = asdict(result)
    bounded: dict[str, object] = {
        "status": "completed",
        "outcome": str(payload.get("outcome") or ""),
        query_key: query_value,
        "source_ref_count": _source_ref_count_from_payload(payload),
    }
    for key in (
        "guide_focus",
        "contact_focus",
        "resolved_subject",
        "observed_status",
        "resolved_date",
        "academic_year_label",
        "term_label",
        "week_index",
        "day_kind",
        "class_day_pattern",
        "is_makeup_class",
        "holiday_name",
        "queried_time_anchor",
        "effective_from",
        "effective_until",
        "intent",
        "service_status",
        "requested_service_date",
        "answer_focus",
        "event_name",
        "event_type",
        "event_start_date",
        "event_end_date_exclusive",
        "display_start_date",
        "display_end_date",
        "duration_days",
        "requested_date",
        "calendar_record_id",
        "primary_record_id",
    ):
        value = payload.get(key)
        if _has_scalar_sdk_value(value):
            bounded[key] = value
    for key in (
        "source_refs",
        "related_notice_refs",
        "override_source_refs",
        "primary_source_refs",
        "event_aliases",
        "applies_to",
    ):
        value = payload.get(key)
        if isinstance(value, tuple | list):
            normalized = [str(item).strip() for item in value if str(item).strip()]
            if normalized:
                bounded[key] = normalized

    if isinstance(payload.get("resolved_service"), Mapping):
        display_name = str(payload["resolved_service"].get("display_name") or "").strip()
        if display_name:
            bounded["resolved_service"] = {"display_name": display_name}
    if isinstance(payload.get("resolved_contact"), Mapping):
        display_name = str(payload["resolved_contact"].get("display_name") or "").strip()
        if display_name:
            bounded["resolved_contact"] = {"display_name": display_name}
    if isinstance(payload.get("resolved_route"), Mapping):
        resolved_route = payload["resolved_route"]
        route_id = str(resolved_route.get("route_id") or "").strip()
        display_name = str(resolved_route.get("display_name") or "").strip()
        service_family = str(resolved_route.get("service_family") or "").strip()
        bounded_route: dict[str, object] = {}
        if route_id:
            bounded_route["route_id"] = route_id
        if display_name:
            bounded_route["display_name"] = display_name
        if service_family:
            bounded_route["service_family"] = service_family
        if bounded_route:
            bounded["resolved_route"] = bounded_route

    if query_key == "service_query":
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="guide_sections",
            fields=("section_id", "section_type", "title", "content", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="procedure_groups",
            fields=("group_id", "title", "source_refs"),
            nested_list_fields={"steps": ("content", "source_refs")},
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="required_materials",
            fields=("name", "required", "note", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="entry_refs",
            fields=("label", "entry_type", "location_ref", "url", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="office_hours",
            fields=("label", "day_pattern", "time_range", "effective_note", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="contact_refs",
            fields=("label", "department", "phone", "email", "source_refs"),
        )
        eligibility_notes = payload.get("eligibility_notes")
        if isinstance(eligibility_notes, tuple | list):
            normalized_notes = [
                str(item).strip() for item in eligibility_notes if str(item).strip()
            ]
            if normalized_notes:
                bounded["eligibility_notes"] = normalized_notes[:6]
    if query_key == "query_text":
        contact_focus = str(payload.get("contact_focus") or "").strip()
        if contact_focus:
            bounded["contact_focus"] = contact_focus
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="contact_points",
            fields=("channel_type", "label", "value", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="location_refs",
            fields=("label", "location_ref", "address_text", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="office_hours",
            fields=("label", "day_pattern", "time_range", "effective_note", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="related_calendar_contexts",
            fields=(
                "relation",
                "event_name",
                "event_type",
                "display_start_date",
                "display_end_date",
                "duration_days",
                "source_refs",
            ),
        )
    return bounded


def _copy_nested_sdk_result_list(
    payload: Mapping[str, object],
    bounded: dict[str, object],
    *,
    key: str,
    fields: tuple[str, ...],
    nested_list_fields: Mapping[str, tuple[str, ...]] | None = None,
) -> None:
    raw_value = payload.get(key)
    if not isinstance(raw_value, tuple | list):
        return
    items: list[dict[str, object]] = []
    for entry in raw_value[:8]:
        if not isinstance(entry, Mapping):
            continue
        item: dict[str, object] = {}
        for field_name in fields:
            value = entry.get(field_name)
            if value is None:
                continue
            if field_name == "source_refs" and isinstance(value, tuple | list):
                refs = [str(ref).strip() for ref in value if str(ref).strip()]
                if refs:
                    item[field_name] = refs
                continue
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    item[field_name] = normalized
                continue
            if isinstance(value, bool | int | float):
                item[field_name] = value
        if nested_list_fields:
            for nested_key, nested_fields in nested_list_fields.items():
                nested_value = entry.get(nested_key)
                if not isinstance(nested_value, tuple | list):
                    continue
                nested_items: list[dict[str, object]] = []
                for nested_entry in nested_value[:12]:
                    if not isinstance(nested_entry, Mapping):
                        continue
                    nested_item: dict[str, object] = {}
                    for nested_field in nested_fields:
                        nested_field_value = nested_entry.get(nested_field)
                        if nested_field_value is None:
                            continue
                        if nested_field == "source_refs" and isinstance(
                            nested_field_value, tuple | list
                        ):
                            refs = [
                                str(ref).strip() for ref in nested_field_value if str(ref).strip()
                            ]
                            if refs:
                                nested_item[nested_field] = refs
                            continue
                        if isinstance(nested_field_value, str):
                            normalized = nested_field_value.strip()
                            if normalized:
                                nested_item[nested_field] = normalized
                            continue
                        if isinstance(nested_field_value, bool | int | float):
                            nested_item[nested_field] = nested_field_value
                    if nested_item:
                        nested_items.append(nested_item)
                if nested_items:
                    item[nested_key] = nested_items
        if item:
            items.append(item)
    if items:
        bounded[key] = items


def _has_scalar_sdk_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, tuple | list):
        return len(value) > 0
    if isinstance(value, Mapping):
        return len(value) > 0
    return True


def _source_ref_count_from_payload(payload: object) -> int:
    refs: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, Mapping):
            for key, item in value.items():
                normalized_key = str(key)
                if normalized_key == "source_ref" and isinstance(item, str) and item.strip():
                    refs.add(item.strip())
                    continue
                if normalized_key.endswith(("source_refs", "notice_refs")) and isinstance(
                    item, tuple | list
                ):
                    refs.update(str(ref).strip() for ref in item if str(ref).strip())
                    continue
                collect(item)
            return
        if isinstance(value, tuple | list):
            for item in value:
                collect(item)

    collect(payload)
    return len(refs)


__all__ = ["execute_campus_services_sdk_tool"]
