from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    ContextProjection,
    ScheduledDeparture,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    SpecialistRequest,
    TransportRouteRef,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportStopRef,
)
from campus_services_agent import tool_adapter as campus_services_tool_adapter
from campus_services_agent.query_service import (
    CampusServicesAccessContext,
    ServiceStatusQuery,
    TransportScheduleQuery,
)
from campus_services_agent.service import delegate_to_campus_services_agent


class _FakeCampusServicesQueryService:
    def __init__(self) -> None:
        self.last_service_status_query: ServiceStatusQuery | None = None
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


class CampusServicesAgentTest(unittest.TestCase):
    def test_service_status_payload_routes_through_internal_query_service(self) -> None:
        query_service = _FakeCampusServicesQueryService()
        request = SpecialistRequest(
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
            SpecialistRequest(
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

    def test_missing_query_service_returns_error_response(self) -> None:
        response = delegate_to_campus_services_agent(
            SpecialistRequest(
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


if __name__ == "__main__":
    unittest.main()
