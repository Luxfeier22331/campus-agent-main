from __future__ import annotations

import json
from dataclasses import asdict
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_contracts import (
    AcademicCalendarLookupResult,
    AcademicCalendarRelatedContext,
    ContactDirectoryCandidate,
    ContactDirectoryContactPoint,
    ContactDirectoryContactRef,
    ContactDirectoryLocationRef,
    ContactDirectoryLookupResult,
    ContactDirectoryOfficeHours,
    ScheduledDeparture,
    ServiceGuideCandidate,
    ServiceGuideContactRef,
    ServiceGuideEntryRef,
    ServiceGuideLookupResult,
    ServiceGuideMaterial,
    ServiceGuideOfficeHours,
    ServiceGuideProcedureGroup,
    ServiceGuideProcedureStep,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    ServiceStatusLookupResult,
    TransportOperationalNotice,
    TransportRouteCandidate,
    TransportRouteRef,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportServiceWindow,
    TransportStopRef,
)

from campus_services_agent.query_service import (
    AcademicCalendarQuery,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)


class QueryHTTPTransport(Protocol):
    def __call__(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]: ...


class CampusServicesHTTPQueryService:
    def __init__(
        self,
        *,
        base_url: str,
        shared_secret: str,
        timeout_seconds: float = 1.0,
        transport: QueryHTTPTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.shared_secret = shared_secret.strip()
        self.timeout_seconds = timeout_seconds
        self._transport = transport or self._default_transport
        if not self.base_url:
            raise ValueError("base_url must not be empty")
        if not self.shared_secret:
            raise ValueError("shared_secret must not be empty")

    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult:
        body = self._post(
            "/internal/query/campus-services/service-status",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _service_status_result_from_dict(
            body,
            fallback_subject_query=query.payload.subject_query,
        )

    def lookup_service_guide(self, query: ServiceGuideQuery) -> ServiceGuideLookupResult:
        body = self._post(
            "/internal/query/campus-services/service-guide",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _service_guide_result_from_dict(
            body,
            fallback_service_query=query.payload.service_query,
            fallback_guide_focus=str(query.payload.guide_focus),
        )

    def lookup_contact_directory(
        self,
        query: ContactDirectoryQuery,
    ) -> ContactDirectoryLookupResult:
        body = self._post(
            "/internal/query/campus-services/contact-directory",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _contact_directory_result_from_dict(
            body,
            fallback_query_text=query.payload.query_text,
            fallback_contact_focus=str(query.payload.contact_focus),
        )

    def lookup_academic_calendar(
        self,
        query: AcademicCalendarQuery,
    ) -> AcademicCalendarLookupResult:
        body = self._post(
            "/internal/query/calendar/academic-calendar",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _academic_calendar_result_from_dict(
            body,
            fallback_query_text=query.payload.query_text,
        )

    def lookup_transport_schedule(
        self,
        query: TransportScheduleQuery,
    ) -> TransportScheduleLookupResult:
        body = self._post(
            "/internal/query/campus-services/transport-schedule",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _transport_schedule_result_from_dict(
            body,
            fallback_query_text=query.payload.query_text,
            fallback_intent=str(query.payload.intent),
        )

    def _post(self, path: str, json_body: dict[str, object]) -> dict[str, object]:
        status_code, body = self._transport(
            f"{self.base_url}{path}",
            headers={
                "content-type": "application/json",
                "x-supervisor-query-auth": self.shared_secret,
            },
            json_body=json_body,
            timeout_seconds=self.timeout_seconds,
        )
        if status_code < 200 or status_code >= 300:
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            message = str(error.get("message") or f"query service returned HTTP {status_code}")
            raise RuntimeError(message)
        return body

    @staticmethod
    def _default_transport(
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]:
        request = Request(
            url,
            data=json.dumps(json_body, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.status, _decode_json_object(response.read())
        except HTTPError as exc:
            return exc.code, _decode_json_object(exc.read())
        except URLError as exc:
            raise RuntimeError(f"query service request failed: {exc}") from exc


def _decode_json_object(raw: bytes) -> dict[str, object]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("query service returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise RuntimeError("query service response must be a JSON object")
    return value


def _query_body(
    *,
    payload: dict[str, object],
    access_context: dict[str, object],
) -> dict[str, object]:
    return {
        "payload": payload,
        "access_context": access_context,
    }


def _service_status_result_from_dict(
    body: dict[str, object],
    *,
    fallback_subject_query: str,
) -> ServiceStatusLookupResult:
    return ServiceStatusLookupResult(
        subject_query=_string(body.get("subject_query")) or fallback_subject_query,
        outcome=_string(body.get("outcome")),
        resolved_subject=_string(body.get("resolved_subject")),
        observed_status=_string(body.get("observed_status")),
        status_note=_string(body.get("status_note")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        override_source_refs=_string_tuple(body.get("override_source_refs")),
        related_notice_refs=_string_tuple(body.get("related_notice_refs")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _service_guide_result_from_dict(
    body: dict[str, object],
    *,
    fallback_service_query: str,
    fallback_guide_focus: str,
) -> ServiceGuideLookupResult:
    return ServiceGuideLookupResult(
        service_query=_string(body.get("service_query")) or fallback_service_query,
        guide_focus=_string(body.get("guide_focus")) or fallback_guide_focus,
        outcome=_string(body.get("outcome")),
        resolved_service=_service_guide_service_ref(body.get("resolved_service")),
        guide_sections=tuple(
            section
            for item in _list(body.get("guide_sections"))
            if (section := _service_guide_section(item)) is not None
        ),
        procedure_groups=tuple(
            group
            for item in _list(body.get("procedure_groups"))
            if (group := _service_guide_procedure_group(item)) is not None
        ),
        required_materials=tuple(
            material
            for item in _list(body.get("required_materials"))
            if (material := _service_guide_material(item)) is not None
        ),
        entry_refs=tuple(
            entry
            for item in _list(body.get("entry_refs"))
            if (entry := _service_guide_entry(item)) is not None
        ),
        office_hours=tuple(
            hours
            for item in _list(body.get("office_hours"))
            if (hours := _service_guide_hours(item)) is not None
        ),
        contact_refs=tuple(
            contact
            for item in _list(body.get("contact_refs"))
            if (contact := _service_guide_contact(item)) is not None
        ),
        eligibility_notes=_string_tuple(body.get("eligibility_notes")),
        source_refs=_string_tuple(body.get("source_refs")),
        candidate_services=tuple(
            candidate
            for item in _list(body.get("candidate_services"))
            if (candidate := _service_guide_candidate(item)) is not None
        ),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        clarification_reason=_string(body.get("clarification_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
        matched_service_category=_string(body.get("matched_service_category")),
        selected_section_ids=_string_tuple(body.get("selected_section_ids")),
        omitted_section_ids=_string_tuple(body.get("omitted_section_ids")),
        omitted_section_reasons=_string_mapping(body.get("omitted_section_reasons")),
        field_status=_string_mapping(body.get("field_status")),
    )


def _contact_directory_result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
    fallback_contact_focus: str,
) -> ContactDirectoryLookupResult:
    return ContactDirectoryLookupResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        contact_focus=_string(body.get("contact_focus")) or fallback_contact_focus,
        outcome=_string(body.get("outcome")),
        resolved_contact=_contact_directory_contact_ref(body.get("resolved_contact")),
        contact_points=tuple(
            point
            for item in _list(body.get("contact_points"))
            if (point := _contact_directory_contact_point(item)) is not None
        ),
        location_refs=tuple(
            location
            for item in _list(body.get("location_refs"))
            if (location := _contact_directory_location_ref(item)) is not None
        ),
        office_hours=tuple(
            hours
            for item in _list(body.get("office_hours"))
            if (hours := _contact_directory_office_hours(item)) is not None
        ),
        candidate_contacts=tuple(
            candidate
            for item in _list(body.get("candidate_contacts"))
            if (candidate := _contact_directory_candidate(item)) is not None
        ),
        source_refs=_string_tuple(body.get("source_refs")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        clarification_reason=_string(body.get("clarification_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
        field_status=_string_mapping(body.get("field_status")),
    )


def _transport_schedule_result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
    fallback_intent: str,
) -> TransportScheduleLookupResult:
    return TransportScheduleLookupResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        intent=_string(body.get("intent")) or fallback_intent,
        outcome=_string(body.get("outcome")),
        resolved_route=_transport_route_ref(body.get("resolved_route")),
        service_status=_string(body.get("service_status")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        requested_service_date=_string(body.get("requested_service_date")),
        selected_departure=_scheduled_departure(body.get("selected_departure")),
        departure_options=tuple(
            departure
            for item in _list(body.get("departure_options"))
            if (departure := _scheduled_departure(item)) is not None
        ),
        service_window=_service_window(body.get("service_window")),
        schedule_snapshot=_schedule_snapshot(body.get("schedule_snapshot")),
        timetable_entries=tuple(
            departure
            for item in _list(body.get("timetable_entries"))
            if (departure := _scheduled_departure(item)) is not None
        ),
        candidate_routes=tuple(
            candidate
            for item in _list(body.get("candidate_routes"))
            if (candidate := _route_candidate(item)) is not None
        ),
        clarification_reason=_string(body.get("clarification_reason")),
        stop_refs=tuple(
            stop for item in _list(body.get("stop_refs")) if (stop := _stop_ref(item)) is not None
        ),
        related_notice_refs=_string_tuple(body.get("related_notice_refs")),
        operational_notices=tuple(
            notice
            for item in _list(body.get("operational_notices"))
            if (notice := _operational_notice(item)) is not None
        ),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _academic_calendar_result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
) -> AcademicCalendarLookupResult:
    return AcademicCalendarLookupResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        outcome=_string(body.get("outcome")),
        answer_focus=_string(body.get("answer_focus")),
        requested_date=_string(body.get("requested_date")),
        resolved_date=_string(body.get("resolved_date")),
        academic_year_label=_string(body.get("academic_year_label")),
        term_label=_string(body.get("term_label")),
        week_index=_int_or_none(body.get("week_index")),
        day_kind=_string(body.get("day_kind")),
        class_day_pattern=_string(body.get("class_day_pattern")),
        is_makeup_class=_bool_or_none(body.get("is_makeup_class")),
        holiday_name=_string(body.get("holiday_name")),
        source_refs=_string_tuple(body.get("source_refs")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        fail_close_reason=_string(body.get("fail_close_reason")),
        query_kind=_string(body.get("query_kind")),
        event_name=_string(body.get("event_name")),
        event_type=_string(body.get("event_type")),
        event_aliases=_string_tuple(body.get("event_aliases")),
        event_start_date=_string(body.get("event_start_date")),
        event_end_date_exclusive=_string(body.get("event_end_date_exclusive")),
        display_start_date=_string(body.get("display_start_date")),
        display_end_date=_string(body.get("display_end_date")),
        applies_to=_string_tuple(body.get("applies_to")),
        source_title=_string(body.get("source_title")),
        source_url=_string(body.get("source_url")),
        calendar_record_id=_string(body.get("calendar_record_id")),
        conflict_refs=_string_tuple(body.get("conflict_refs")),
        duration_days=_int_or_none(body.get("duration_days")),
        primary_record_id=_string(body.get("primary_record_id")),
        primary_source_refs=_string_tuple(body.get("primary_source_refs")),
        related_calendar_contexts=tuple(
            context
            for item in _list(body.get("related_calendar_contexts"))
            if (context := _academic_calendar_related_context(item)) is not None
        ),
    )


def _academic_calendar_related_context(value: object) -> AcademicCalendarRelatedContext | None:
    item = _dict(value)
    if item is None:
        return None
    return AcademicCalendarRelatedContext(
        relation=_string(item.get("relation")),
        event_name=_string(item.get("event_name")),
        event_type=_string(item.get("event_type")),
        display_start_date=_string(item.get("display_start_date")),
        display_end_date=_string(item.get("display_end_date")),
        duration_days=_int_or_none(item.get("duration_days")),
        applies_to=_string_tuple(item.get("applies_to")),
        source_refs=_string_tuple(item.get("source_refs")),
        source_title=_string(item.get("source_title")),
        source_url=_string(item.get("source_url")),
    )


def _service_guide_service_ref(value: object) -> ServiceGuideServiceRef | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideServiceRef(
        service_id=_string(item.get("service_id")),
        display_name=_string(item.get("display_name")),
        aliases=_string_tuple(item.get("aliases")),
        category=_string(item.get("category")),
        campus_scope=_string(item.get("campus_scope")),
        audience=_string_tuple(item.get("audience")),
    )


def _service_guide_section(value: object) -> ServiceGuideSection | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideSection(
        section_id=_string(item.get("section_id")),
        section_type=_string(item.get("section_type")),
        title=_string(item.get("title")),
        content=_string(item.get("content")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_procedure_step(value: object) -> ServiceGuideProcedureStep | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideProcedureStep(
        step_id=_string(item.get("step_id")),
        content=_string(item.get("content")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_procedure_group(value: object) -> ServiceGuideProcedureGroup | None:
    item = _dict(value)
    if item is None:
        return None
    steps = tuple(
        step
        for raw_step in _list(item.get("steps"))
        if (step := _service_guide_procedure_step(raw_step)) is not None
    )
    if not steps:
        return None
    return ServiceGuideProcedureGroup(
        group_id=_string(item.get("group_id")),
        title=_string(item.get("title")),
        focus_tags=_string_tuple(item.get("focus_tags")),
        steps=steps,
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_material(value: object) -> ServiceGuideMaterial | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideMaterial(
        name=_string(item.get("name")),
        required=bool(item.get("required")),
        note=_string(item.get("note")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_entry(value: object) -> ServiceGuideEntryRef | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideEntryRef(
        label=_string(item.get("label")),
        entry_type=_string(item.get("entry_type")),
        url=_string(item.get("url")),
        location_ref=_string(item.get("location_ref")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_hours(value: object) -> ServiceGuideOfficeHours | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideOfficeHours(
        label=_string(item.get("label")),
        day_pattern=_string(item.get("day_pattern")),
        time_range=_string(item.get("time_range")),
        effective_note=_string(item.get("effective_note")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_contact(value: object) -> ServiceGuideContactRef | None:
    item = _dict(value)
    if item is None:
        return None
    return ServiceGuideContactRef(
        label=_string(item.get("label")),
        department=_string(item.get("department")),
        phone=_string(item.get("phone")),
        email=_string(item.get("email")),
        location_ref=_string(item.get("location_ref")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _service_guide_candidate(value: object) -> ServiceGuideCandidate | None:
    item = _dict(value)
    if item is None:
        return None
    service = _service_guide_service_ref(item.get("service"))
    if service is None:
        return None
    return ServiceGuideCandidate(
        service=service,
        clarification_hint=_string(item.get("clarification_hint")),
    )


def _contact_directory_contact_ref(value: object) -> ContactDirectoryContactRef | None:
    item = _dict(value)
    if item is None:
        return None
    return ContactDirectoryContactRef(
        contact_id=_string(item.get("contact_id")),
        display_name=_string(item.get("display_name")),
        aliases=_string_tuple(item.get("aliases")),
        entity_type=_string(item.get("entity_type")) or "department",
        department=_string(item.get("department")),
        contact_group=_string(item.get("contact_group")),
        campus_scope=_string(item.get("campus_scope")),
        audience=_string_tuple(item.get("audience")),
    )


def _contact_directory_contact_point(value: object) -> ContactDirectoryContactPoint | None:
    item = _dict(value)
    if item is None:
        return None
    return ContactDirectoryContactPoint(
        channel_type=_string(item.get("channel_type")),
        label=_string(item.get("label")),
        value=_string(item.get("value")),
        normalized_value=_string(item.get("normalized_value")),
        contact_type=_string(item.get("contact_type")),
        area_served=_string(item.get("area_served")),
        available_language=_string(item.get("available_language")),
        hours_ref=_string(item.get("hours_ref")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _contact_directory_location_ref(value: object) -> ContactDirectoryLocationRef | None:
    item = _dict(value)
    if item is None:
        return None
    return ContactDirectoryLocationRef(
        label=_string(item.get("label")),
        location_ref=_string(item.get("location_ref")),
        address_text=_string(item.get("address_text")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _contact_directory_office_hours(value: object) -> ContactDirectoryOfficeHours | None:
    item = _dict(value)
    if item is None:
        return None
    return ContactDirectoryOfficeHours(
        hours_id=_string(item.get("hours_id")),
        label=_string(item.get("label")),
        day_pattern=_string(item.get("day_pattern")),
        time_range=_string(item.get("time_range")),
        effective_note=_string(item.get("effective_note")),
        source_refs=_string_tuple(item.get("source_refs")),
    )


def _contact_directory_candidate(value: object) -> ContactDirectoryCandidate | None:
    item = _dict(value)
    if item is None:
        return None
    contact = _contact_directory_contact_ref(item.get("contact"))
    if contact is None:
        return None
    return ContactDirectoryCandidate(
        contact=contact,
        clarification_hint=_string(item.get("clarification_hint")),
    )


def _transport_route_ref(value: object) -> TransportRouteRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportRouteRef(
        route_id=_string(item.get("route_id")),
        display_name=_string(item.get("display_name")),
        service_family=_string(item.get("service_family")),
    )


def _stop_ref(value: object) -> TransportStopRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportStopRef(
        stop_id=_string(item.get("stop_id")),
        display_name=_string(item.get("display_name")),
    )


def _scheduled_departure(value: object) -> ScheduledDeparture | None:
    item = _dict(value)
    if item is None:
        return None
    return ScheduledDeparture(
        departure_at=_string(item.get("departure_at")),
        arrival_at=_string(item.get("arrival_at")),
        origin_stop_ref=_stop_ref(item.get("origin_stop_ref")),
        destination_stop_ref=_stop_ref(item.get("destination_stop_ref")),
    )


def _service_window(value: object) -> TransportServiceWindow | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportServiceWindow(
        first_departure_at=_string(item.get("first_departure_at")),
        last_departure_at=_string(item.get("last_departure_at")),
    )


def _schedule_snapshot(value: object) -> TransportScheduleSnapshotRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportScheduleSnapshotRef(
        snapshot_id=_string(item.get("snapshot_id")),
        published_at=_string(item.get("published_at")),
        effective_from=_string(item.get("effective_from")),
        effective_until=_string(item.get("effective_until")),
        source_ref=_string(item.get("source_ref")),
    )


def _route_candidate(value: object) -> TransportRouteCandidate | None:
    item = _dict(value)
    if item is None:
        return None
    route = _transport_route_ref(item.get("route"))
    if route is None:
        return None
    return TransportRouteCandidate(
        route=route,
        clarification_hint=_string(item.get("clarification_hint")),
    )


def _operational_notice(value: object) -> TransportOperationalNotice | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportOperationalNotice(
        notice_id=_string(item.get("notice_id")),
        source_ref=_string(item.get("source_ref")),
        notice_kind=_string(item.get("notice_kind")),
        route_ids=_string_tuple(item.get("route_ids")),
        effective_from=_string(item.get("effective_from")),
        effective_until=_string(item.get("effective_until")),
        operational_comment=_string(item.get("operational_comment")),
    )


def _dict(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    return None


def _list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    return []


def _string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_tuple(value: object) -> tuple[str, ...]:
    return tuple(_string(item) for item in _list(value) if _string(item))


def _int_or_none(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _bool_or_none(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _string_mapping(value: object) -> dict[str, str]:
    item = _dict(value)
    if item is None:
        return {}
    return {
        _string(key): _string(raw_value)
        for key, raw_value in item.items()
        if _string(key) and _string(raw_value)
    }
