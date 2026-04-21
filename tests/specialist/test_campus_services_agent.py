from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    ContextProjection,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    SpecialistRequest,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
    TransportStopRef,
)
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
            route_query=query.payload.route_query,
            outcome="resolved_current",
            resolved_route="海淀校区摆渡线",
            service_status="running",
            queried_time_anchor="2026-04-21T10:30:00+08:00",
            window_start="2026-04-21T08:00:00+08:00",
            window_end="2026-04-21T20:00:00+08:00",
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
                payload=TransportScheduleLookupPayload(route_query="校车"),
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


if __name__ == "__main__":
    unittest.main()
