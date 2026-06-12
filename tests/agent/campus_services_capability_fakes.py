from __future__ import annotations

from campus_contracts import (
    AcademicCalendarLookupResult,
    AcademicCalendarRelatedContext,
    ContactDirectoryContactPoint,
    ContactDirectoryContactRef,
    ContactDirectoryLookupResult,
    ScheduledDeparture,
    ServiceGuideLookupResult,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    ServiceStatusLookupResult,
    TransportOperationalNotice,
    TransportRouteRef,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportStopRef,
)
from campus_services_capability.query_service import (
    AcademicCalendarQuery,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)


class FakeCampusServicesQueryService:
    def __init__(self) -> None:
        self.last_service_status_query: ServiceStatusQuery | None = None
        self.last_service_guide_query: ServiceGuideQuery | None = None
        self.last_transport_schedule_query: TransportScheduleQuery | None = None
        self.last_contact_directory_query: ContactDirectoryQuery | None = None
        self.last_academic_calendar_query: AcademicCalendarQuery | None = None

    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult:
        self.last_service_status_query = query
        return ServiceStatusLookupResult(
            subject_query=query.payload.subject_query,
            outcome="resolved_current",
            resolved_subject="海淀校区图书馆",
            observed_status="open",
            status_note="工作日开放，节假日另行通知",
            queried_time_anchor="2026-04-21T10:30:00+08:00",
            effective_from="2026-04-21T08:00:00+08:00",
            effective_until="2026-04-21T22:00:00+08:00",
            related_notice_refs=("notice:library-hours",),
        )

    def lookup_service_guide(self, query: ServiceGuideQuery) -> ServiceGuideLookupResult:
        self.last_service_guide_query = query
        return ServiceGuideLookupResult(
            service_query=query.payload.service_query,
            guide_focus=query.payload.guide_focus,
            outcome="resolved_current",
            resolved_service=ServiceGuideServiceRef(
                service_id="service:handbook:check-in",
                display_name="公寓楼新生办理入住手续流程",
                aliases=("入住", "宿舍"),
                category="student_housing",
                campus_scope="all",
                audience=("student",),
            ),
            guide_sections=(
                ServiceGuideSection(
                    section_id="service:handbook:check-in:section:procedure",
                    section_type="procedure",
                    title="公寓楼新生办理入住手续流程",
                    content="1. 持通知书到院系注册。\n2. 到指定公寓楼报到。",
                    source_refs=("handbook:student_rules:pages:252-255#page=253",),
                ),
            ),
            source_refs=("handbook:student_rules:pages:252-255#page=253",),
            queried_time_anchor="2026-04-25T10:30:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
            field_status={"contact": "source_not_provided"},
            matched_service_category="student_housing",
        )

    def lookup_transport_schedule(
        self, query: TransportScheduleQuery
    ) -> TransportScheduleLookupResult:
        self.last_transport_schedule_query = query
        return TransportScheduleLookupResult(
            query_text=query.payload.query_text,
            intent=query.payload.intent,
            outcome="resolved_current",
            resolved_route=TransportRouteRef(
                route_id="route:haidian-shuttle",
                display_name="海淀校区摆渡线",
                service_family="campus_shuttle",
            ),
            service_status="running",
            queried_time_anchor="2026-04-21T10:30:00+08:00",
            requested_service_date="2026-04-21",
            selected_departure=ScheduledDeparture(
                departure_at="2026-04-21T11:00:00+08:00",
                origin_stop_ref=TransportStopRef(
                    stop_id="haidian-library",
                    display_name="图书馆站",
                ),
                destination_stop_ref=TransportStopRef(
                    stop_id="haidian-dorm",
                    display_name="学生公寓站",
                ),
            ),
            schedule_snapshot=TransportScheduleSnapshotRef(
                snapshot_id="snapshot:2026-04-20",
                published_at="2026-04-20T18:00:00+08:00",
                source_ref="notice:bus-schedule-2026-04-20",
            ),
            stop_refs=(TransportStopRef(stop_id="haidian-library", display_name="图书馆站"),),
            operational_notices=(
                TransportOperationalNotice(
                    notice_id="353903",
                    source_ref="notice:muc_internal_portal:353903",
                    notice_kind="boarding_point_change",
                    route_ids=("route:haidian-shuttle",),
                    effective_from="2026-04-21T00:00:00+08:00",
                    operational_comment="海淀校区乘车点临时调整至图书馆站",
                ),
            ),
        )

    def lookup_contact_directory(
        self,
        query: ContactDirectoryQuery,
    ) -> ContactDirectoryLookupResult:
        self.last_contact_directory_query = query
        return ContactDirectoryLookupResult(
            query_text=query.payload.query_text,
            contact_focus=query.payload.contact_focus,
            outcome="resolved_current",
            resolved_contact=ContactDirectoryContactRef(
                contact_id="contact:grad-admission-office",
                display_name="研究生院招生办公室",
                aliases=("研究生招生办",),
                entity_type="department",
                department="研究生院",
                contact_group="招生咨询",
                campus_scope="haidian",
                audience=("student", "faculty"),
            ),
            contact_points=(
                ContactDirectoryContactPoint(
                    channel_type="phone",
                    label="招生咨询",
                    value="010-68930001",
                    normalized_value="01068930001",
                    source_refs=("handbook:contact-directory:2026#page=261",),
                ),
            ),
            source_refs=("handbook:contact-directory:2026#page=261",),
            queried_time_anchor="2026-04-27T10:30:00+08:00",
            field_status={"office_hours": "source_not_provided"},
        )

    def lookup_academic_calendar(
        self,
        query: AcademicCalendarQuery,
    ) -> AcademicCalendarLookupResult:
        self.last_academic_calendar_query = query
        return AcademicCalendarLookupResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            query_kind=query.payload.query_kind,
            answer_focus="teaching_week",
            resolved_date="2026-05-05",
            academic_year_label="2025-2026学年",
            term_label="春季学期",
            week_index=11,
            day_kind="teaching_day",
            source_refs=("official_web:academic-calendar-2025-2026",),
            primary_record_id="calendar:official_web:teaching-week-11",
            primary_source_refs=("official_web:academic-calendar-2025-2026",),
            related_calendar_contexts=(
                AcademicCalendarRelatedContext(
                    relation="term_context",
                    event_name="春季学期",
                    event_type="term_window",
                    display_start_date="2026-02-23",
                    display_end_date="2026-07-12",
                    source_refs=("official_web:academic-calendar-2025-2026",),
                ),
            ),
        )


class RecordingQueryHTTPTransport:
    def __init__(self, response_body: dict[str, object]) -> None:
        self.response_body = response_body
        self.calls: list[tuple[str, dict[str, str], dict[str, object], float]] = []

    def __call__(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]:
        self.calls.append((url, headers, json_body, timeout_seconds))
        return 200, self.response_body
