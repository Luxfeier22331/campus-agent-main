from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    ContextProjection,
    NoticeCard,
    SpecialistRequest,
    TemporalQuery,
)
from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeDiscoverQuery,
    NoticeGetQuery,
)
from campus_notice_agent.service import delegate_to_notice_agent


class _FakeNoticeQueryService:
    def __init__(self) -> None:
        self.last_discover_query: NoticeDiscoverQuery | None = None
        self.last_get_query: NoticeGetQuery | None = None

    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult:
        self.last_discover_query = query
        return CampusNoticeDiscoverResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            source_families=("official_web_public_notice",),
            notice_cards=(
                NoticeCard(
                    notice_id="notice:2026-spring-holiday",
                    title="2026 年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://campus.example/notices/spring-holiday",
                    published_at="2026-04-20T09:00:00+08:00",
                ),
            ),
            queried_time_anchor="2026-04-21T10:30:00+08:00",
        )

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
        return CampusNoticeGetResult(
            notice_id=query.payload.notice_id,
            outcome="resolved_current",
            title="2026 年春假安排通知",
            source_family="official_web_public_notice",
            source_url="https://campus.example/notices/spring-holiday",
            canonical_url="https://campus.example/notices/spring-holiday",
            normalized_body="春假时间为 5 月 1 日至 5 月 5 日。",
            published_at="2026-04-20T09:00:00+08:00",
        )


class NoticeAgentTest(unittest.TestCase):
    def test_notice_discover_payload_routes_through_internal_query_service(self) -> None:
        query_service = _FakeNoticeQueryService()
        request = SpecialistRequest(
            target="notice-agent",
            user_goal="找一下春假通知",
            payload=CampusNoticeDiscoverPayload(
                query_text="春假通知",
                temporal_query=TemporalQuery(mode="current_year", year_hint="2026"),
            ),
            allowed_tools=("campus_notice_discover",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_groups=("students",),
                ),
            ),
        )

        response = delegate_to_notice_agent(request, query_service=query_service)

        self.assertEqual(response.target, "notice-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.notice_cards[0].notice_id, "notice:2026-spring-holiday")
        self.assertIn("2026 年春假安排通知", response.answer_text)
        self.assertEqual(
            query_service.last_discover_query,
            NoticeDiscoverQuery(
                payload=CampusNoticeDiscoverPayload(
                    query_text="春假通知",
                    temporal_query=TemporalQuery(mode="current_year", year_hint="2026"),
                ),
                access_context=NoticeAccessContext(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
            ),
        )

    def test_notice_get_payload_rejects_tool_outside_allowed_tools(self) -> None:
        response = delegate_to_notice_agent(
            SpecialistRequest(
                target="notice-agent",
                user_goal="读取这条通知",
                payload=CampusNoticeGetPayload(
                    notice_id="notice:2026-spring-holiday",
                    source_family="official_web_public_notice",
                ),
                allowed_tools=("campus_notice_discover",),
            ),
            query_service=_FakeNoticeQueryService(),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "disallowed_tool")


if __name__ == "__main__":
    unittest.main()
