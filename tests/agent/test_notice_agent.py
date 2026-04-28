from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    ContextProjection,
    NoticeCard,
    TemporalQuery,
)
from campus_notice_agent.http_query_service import NoticeHTTPQueryService
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


class _FakeReferenceOnlyNoticeQueryService(_FakeNoticeQueryService):
    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
        return CampusNoticeGetResult(
            notice_id=query.payload.notice_id,
            outcome="resolved_current",
            title="校园活动通知",
            source_family="wechat_public_notice",
            source_url="https://mp.weixin.qq.com/s/example",
            reference_only=True,
        )


class NoticeAgentTest(unittest.TestCase):
    def test_notice_discover_payload_routes_through_internal_query_service(self) -> None:
        query_service = _FakeNoticeQueryService()
        request = AgentRequest(
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
            AgentRequest(
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

    def test_http_query_service_posts_discover_payload_and_authorization_projection(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "query_text": "家具采购",
                "outcome": "resolved_current",
                "source_families": ["internal_notice_restricted"],
                "notice_cards": [
                    {
                        "notice_id": "355222",
                        "title": "中央民族大学丰台校区家具采购项目比选公告",
                        "source_family": "internal_notice_restricted",
                        "source_url": "https://portal.example.edu/notices/355222",
                        "canonical_url": "https://portal.example.edu/notices/355222",
                        "published_at": "2026-04-12",
                        "effective_at": "2026-04-12",
                        "target_surface": "notice_level_query",
                        "is_current": True,
                    }
                ],
                "queried_time_anchor": "2026-04-24T10:30:00+08:00",
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.discover_notice(
            NoticeDiscoverQuery(
                payload=CampusNoticeDiscoverPayload(
                    query_text="家具采购",
                    source_families=("internal_notice_restricted",),
                    target_surfaces=("notice_level_query",),
                    max_results=3,
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://supervisor-api.internal/internal/query/notices/discover",
        )
        self.assertEqual(transport.calls[0][1]["x-supervisor-query-auth"], "query-secret")
        self.assertEqual(transport.calls[0][2]["payload"]["query_text"], "家具采购")
        self.assertEqual(
            transport.calls[0][2]["payload"]["target_surfaces"],
            ("notice_level_query",),
        )
        self.assertEqual(
            transport.calls[0][2]["access_context"]["authorization"]["retrieval_filter"][
                "visibility_level"
            ],
            "restricted",
        )
        self.assertEqual(transport.calls[0][3], 0.75)
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.notice_cards[0].notice_id, "355222")
        self.assertEqual(result.notice_cards[0].target_surface, "notice_level_query")

    def test_http_query_service_posts_get_payload_and_decodes_body_result(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "notice_id": "355222",
                "outcome": "resolved_current",
                "title": "中央民族大学丰台校区家具采购项目比选公告",
                "source_family": "internal_notice_restricted",
                "source_url": "https://portal.example.edu/notices/355222",
                "canonical_url": "https://portal.example.edu/notices/355222",
                "normalized_body": "# 采购公告\n\n供应商应按要求投标。\n",
                "published_at": "2026-04-12",
                "effective_at": "2026-04-12",
                "target_surface": "notice_level_query",
                "attachment_refs": ["attachment:355222:1"],
                "provenance_refs": ["notice:muc_internal_portal:355222"],
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.get_notice(
            NoticeGetQuery(
                payload=CampusNoticeGetPayload(
                    notice_id="355222",
                    source_family="internal_notice_restricted",
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://supervisor-api.internal/internal/query/notices/get",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["notice_id"], "355222")
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.normalized_body, "# 采购公告\n\n供应商应按要求投标。\n")
        self.assertEqual(result.target_surface, "notice_level_query")
        self.assertEqual(result.attachment_refs, ("attachment:355222:1",))

    def test_http_query_service_decodes_reference_only_notice_get_result(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "notice_id": "wechat:article:001",
                "outcome": "resolved_current",
                "title": "校园活动通知",
                "source_family": "wechat_public_notice",
                "source_url": "https://mp.weixin.qq.com/s/example",
                "reference_only": True,
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            transport=transport,
        )

        result = query_service.get_notice(
            NoticeGetQuery(
                payload=CampusNoticeGetPayload(
                    notice_id="wechat:article:001",
                    source_family="wechat_public_notice",
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertTrue(result.reference_only)
        self.assertEqual(result.normalized_body, "")

    def test_notice_get_reference_only_result_returns_source_url_answer(self) -> None:
        response = delegate_to_notice_agent(
            AgentRequest(
                target="notice-agent",
                user_goal="读取这条公众号通知",
                payload=CampusNoticeGetPayload(
                    notice_id="wechat:article:001",
                    source_family="wechat_public_notice",
                ),
                allowed_tools=("campus_notice_get",),
                actor=ActorContext(user_id="student-001"),
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_groups=("students",),
                    ),
                ),
            ),
            query_service=_FakeReferenceOnlyNoticeQueryService(),
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("仅提供原文链接", response.answer_text)
        self.assertIn("https://mp.weixin.qq.com/s/example", response.answer_text)


def _restricted_access_context() -> NoticeAccessContext:
    return NoticeAccessContext(
        actor=ActorContext(user_id="student-001"),
        authorization=AuthorizationProjection(
            principal_id="principal-001",
            entitlement_groups=("students",),
            retrieval_filter=AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="restricted",
            ),
        ),
    )


class _RecordingNoticeHTTPTransport:
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


if __name__ == "__main__":
    unittest.main()
