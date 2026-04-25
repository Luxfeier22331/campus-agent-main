from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    ContextProjection,
    ScheduledDeparture,
    ServiceGuideContactRef,
    ServiceGuideLookupPayload,
    ServiceGuideLookupResult,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    AgentRequest,
    TransportRouteRef,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportServiceWindow,
    TransportStopRef,
)
from campus_services_agent import tool_adapter as campus_services_tool_adapter
from campus_services_agent.http_query_service import CampusServicesHTTPQueryService
from campus_services_agent.query_service import (
    CampusServicesAccessContext,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)
from campus_services_agent.service import delegate_to_campus_services_agent


class _FakeCampusServicesQueryService:
    def __init__(self) -> None:
        self.last_service_status_query: ServiceStatusQuery | None = None
        self.last_service_guide_query: ServiceGuideQuery | None = None
        self.last_transport_schedule_query: TransportScheduleQuery | None = None

    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult:
        self.last_service_status_query = query
        return ServiceStatusLookupResult(
            subject_query=query.payload.subject_query,
            outcome="resolved_current",
            resolved_subject="海淀校区图书馆",
            observed_status="open",
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
        )


class _RecordingQueryHTTPTransport:
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


class CampusServicesAgentTest(unittest.TestCase):
    def test_service_status_payload_routes_through_internal_query_service(self) -> None:
        query_service = _FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="图书馆今天开门吗",
            payload=ServiceStatusLookupPayload(
                subject_query="图书馆今天开门吗",
            ),
            allowed_tools=("service_status_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_groups=("students",),
                ),
            ),
        )

        response = delegate_to_campus_services_agent(request, query_service=query_service)

        self.assertEqual(response.target, "campus-services-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.resolved_subject, "海淀校区图书馆")
        self.assertIn("海淀校区图书馆", response.answer_text)
        self.assertEqual(
            query_service.last_service_status_query,
            ServiceStatusQuery(
                payload=ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
                access_context=CampusServicesAccessContext(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
            ),
        )

    def test_transport_schedule_payload_rejects_tool_outside_allowed_tools(self) -> None:
        response = delegate_to_campus_services_agent(
            AgentRequest(
                target="campus-services-agent",
                user_goal="校车什么时候发车",
                payload=TransportScheduleLookupPayload(
                    query_text="校车什么时候发车",
                    intent="next_departure",
                ),
                allowed_tools=("service_status_lookup",),
            ),
            query_service=_FakeCampusServicesQueryService(),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "disallowed_tool")

    def test_service_guide_payload_routes_through_internal_query_service(self) -> None:
        query_service = _FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="宿舍入住怎么办理",
            payload=ServiceGuideLookupPayload(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
            ),
            allowed_tools=("service_guide_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        response = delegate_to_campus_services_agent(request, query_service=query_service)

        self.assertEqual(response.status, "completed")
        self.assertIn("公寓楼新生办理入住手续流程", response.answer_text)
        self.assertEqual(
            query_service.last_service_guide_query.payload.service_query,
            "宿舍入住怎么办理",
        )

    def test_service_guide_contact_response_includes_contact_channels(self) -> None:
        response = campus_services_tool_adapter._service_guide_response(
            ServiceGuideLookupResult(
                service_query="校医院电话是多少",
                guide_focus="contact",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:handbook:student-public-medical-reimbursement",
                    display_name="公费医疗报销办理指南",
                    aliases=("公费医疗报销",),
                    category="student_public_medical",
                    campus_scope="all",
                    audience=("student",),
                ),
                contact_refs=(
                    ServiceGuideContactRef(
                        label="校医院",
                        department="校医院",
                        phone="68930000",
                        email="hospital@example.edu",
                        source_refs=("handbook:student_rules:pages:261-261#page=261",),
                    ),
                ),
                source_refs=("handbook:student_rules:pages:261-261#page=261",),
                queried_time_anchor="2026-04-26T10:30:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="student_public_medical",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("校医院", response.answer_text)
        self.assertIn("68930000", response.answer_text)
        self.assertIn("hospital@example.edu", response.answer_text)

    def test_missing_query_service_returns_error_response(self) -> None:
        response = delegate_to_campus_services_agent(
            AgentRequest(
                target="campus-services-agent",
                user_goal="图书馆今天开门吗",
                payload=ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
                allowed_tools=("service_status_lookup",),
            )
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "internal_query_service_unavailable")

    def test_transport_schedule_response_uses_selected_departure_wording(self) -> None:
        response = campus_services_tool_adapter._transport_schedule_response(
            TransportScheduleLookupResult(
                query_text="明天最早一班去丰台的校车是几点",
                intent="first_departure",
                outcome="resolved_current",
                resolved_route=TransportRouteRef(
                    route_id="route:haidian-to-fengtai",
                    display_name="海淀到丰台通勤车",
                    service_family="intercampus_commute",
                ),
                service_status="running",
                queried_time_anchor="2026-04-21T20:30:00+08:00",
                requested_service_date="2026-04-22",
                selected_departure=ScheduledDeparture(
                    departure_at="2026-04-22T07:10:00+08:00",
                    origin_stop_ref=TransportStopRef(
                        stop_id="stop:haidian-east-gate",
                        display_name="海淀东门",
                    ),
                    destination_stop_ref=TransportStopRef(
                        stop_id="stop:fengtai-main-gate",
                        display_name="丰台南门",
                    ),
                ),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("海淀到丰台通勤车", response.answer_text)
        self.assertIn("2026-04-22T07:10:00+08:00", response.answer_text)

    def test_transport_schedule_response_lists_departure_options(self) -> None:
        response = campus_services_tool_adapter._transport_schedule_response(
            TransportScheduleLookupResult(
                query_text="今天下午 5 点以后去丰台还有哪些班车",
                intent="departure_list",
                outcome="resolved_current",
                resolved_route=TransportRouteRef(
                    route_id="route:haidian-to-fengtai",
                    display_name="海淀到丰台通勤车",
                    service_family="intercampus_commute",
                ),
                service_status="running",
                queried_time_anchor="2026-04-24T16:45:00+08:00",
                requested_service_date="2026-04-24",
                departure_options=(
                    ScheduledDeparture(departure_at="2026-04-24T17:10:00+08:00"),
                    ScheduledDeparture(departure_at="2026-04-24T18:00:00+08:00"),
                ),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("海淀到丰台通勤车", response.answer_text)
        self.assertIn("2026-04-24T17:10:00+08:00", response.answer_text)
        self.assertIn("2026-04-24T18:00:00+08:00", response.answer_text)

    def test_transport_schedule_response_describes_service_window(self) -> None:
        response = campus_services_tool_adapter._transport_schedule_response(
            TransportScheduleLookupResult(
                query_text="今天这条线的运营时间是什么",
                intent="service_window",
                outcome="resolved_current",
                resolved_route=TransportRouteRef(
                    route_id="route:haidian-to-fengtai",
                    display_name="海淀到丰台通勤车",
                    service_family="intercampus_commute",
                ),
                service_status="running",
                queried_time_anchor="2026-04-24T10:30:00+08:00",
                requested_service_date="2026-04-24",
                service_window=TransportServiceWindow(
                    first_departure_at="2026-04-24T06:50:00+08:00",
                    last_departure_at="2026-04-24T18:00:00+08:00",
                ),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("运营时间", response.answer_text)
        self.assertIn("2026-04-24T06:50:00+08:00", response.answer_text)
        self.assertIn("2026-04-24T18:00:00+08:00", response.answer_text)

    def test_transport_schedule_response_describes_timetable_entries(self) -> None:
        response = campus_services_tool_adapter._transport_schedule_response(
            TransportScheduleLookupResult(
                query_text="最近的地铁接驳车时刻表是什么",
                intent="timetable",
                outcome="resolved_current",
                resolved_route=TransportRouteRef(
                    route_id="route:subway-shuttle",
                    display_name="地铁接驳车",
                    service_family="subway_shuttle",
                ),
                service_status="running",
                queried_time_anchor="2026-04-24T10:30:00+08:00",
                requested_service_date="2026-04-24",
                timetable_entries=(
                    ScheduledDeparture(departure_at="2026-04-24T08:00:00+08:00"),
                    ScheduledDeparture(departure_at="2026-04-24T08:30:00+08:00"),
                ),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("时刻表", response.answer_text)
        self.assertIn("2026-04-24T08:00:00+08:00", response.answer_text)
        self.assertIn("2026-04-24T08:30:00+08:00", response.answer_text)

    def test_http_query_service_posts_transport_schedule_payload_and_decodes_result(self) -> None:
        transport = _RecordingQueryHTTPTransport(
            {
                "query_text": "我明天早上要去丰台上课，最早的班车是几点",
                "intent": "first_departure",
                "outcome": "resolved_current",
                "resolved_route": {
                    "route_id": "route:haidian-to-fengtai",
                    "display_name": "海淀到丰台通勤车",
                    "service_family": "intercampus_commute",
                },
                "service_status": "running",
                "queried_time_anchor": "2026-04-24T20:30:00+08:00",
                "requested_service_date": "2026-04-25",
                "selected_departure": {
                    "departure_at": "2026-04-25T06:50:00+08:00",
                    "arrival_at": "2026-04-25T08:05:00+08:00",
                    "origin_stop_ref": {
                        "stop_id": "stop:haidian-east-gate",
                        "display_name": "海淀东门",
                    },
                    "destination_stop_ref": {
                        "stop_id": "stop:fengtai-main-gate",
                        "display_name": "丰台南门",
                    },
                },
                "schedule_snapshot": {
                    "snapshot_id": "snapshot:bus:2026-04-20",
                    "published_at": "2026-04-20T18:00:00+08:00",
                    "source_ref": "notice:bus-schedule-2026-04-20",
                },
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_transport_schedule(
            TransportScheduleQuery(
                payload=TransportScheduleLookupPayload(
                    query_text="我明天早上要去丰台上课，最早的班车是几点",
                    intent="first_departure",
                )
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://supervisor-api.internal/internal/query/campus-services/transport-schedule",
        )
        self.assertEqual(transport.calls[0][1]["x-supervisor-query-auth"], "query-secret")
        self.assertEqual(transport.calls[0][2]["intent"], "first_departure")
        self.assertEqual(transport.calls[0][3], 0.75)
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_route.display_name, "海淀到丰台通勤车")
        self.assertEqual(result.selected_departure.departure_at, "2026-04-25T06:50:00+08:00")

    def test_http_query_service_posts_service_guide_payload_and_decodes_result(self) -> None:
        transport = _RecordingQueryHTTPTransport(
            {
                "service_query": "宿舍入住怎么办理",
                "guide_focus": "procedure",
                "outcome": "resolved_current",
                "resolved_service": {
                    "service_id": "service:handbook:check-in",
                    "display_name": "公寓楼新生办理入住手续流程",
                    "aliases": ["入住", "宿舍"],
                    "category": "student_housing",
                    "campus_scope": "all",
                    "audience": ["student"],
                },
                "guide_sections": [
                    {
                        "section_type": "procedure",
                        "title": "公寓楼新生办理入住手续流程",
                        "content": "1. 持通知书到院系注册。\n2. 到指定公寓楼报到。",
                        "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                    }
                ],
                "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                "queried_time_anchor": "2026-04-25T10:30:00+08:00",
                "effective_from": "2018-09-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "matched_service_category": "student_housing",
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=ServiceGuideLookupPayload(
                    service_query="宿舍入住怎么办理",
                    guide_focus="procedure",
                )
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://supervisor-api.internal/internal/query/campus-services/service-guide",
        )
        self.assertEqual(transport.calls[0][2]["guide_focus"], "procedure")
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_service.display_name, "公寓楼新生办理入住手续流程")


if __name__ == "__main__":
    unittest.main()
