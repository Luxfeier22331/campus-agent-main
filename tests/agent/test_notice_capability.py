from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeChangeSetLookupResult,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    CapabilityRequest,
    ContextProjection,
    NoticeCard,
    NoticeDisplayPolicy,
    TemporalQuery,
)
from campus_notice_capability.http_query_service import NoticeHTTPQueryService
from campus_notice_capability.notice_get_runtime import run_notice_get_internal_request
from campus_notice_capability.query_service import (
    NoticeAccessContext,
    NoticeChangeSetLookupQuery,
    NoticeDiscoverQuery,
    NoticeGetQuery,
)
from campus_notice_capability.sdk_tool_executor import execute_notice_sdk_tool
from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolInvocation


class _FakeNoticeQueryService:
    def __init__(self) -> None:
        self.last_discover_query: NoticeDiscoverQuery | None = None
        self.last_change_set_query: NoticeChangeSetLookupQuery | None = None
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
            body_excerpt="春假时间为 5 月 1 日至 5 月 5 日。",
            bounded_summary="春假安排已发布，请以官方原文为准。",
            published_at="2026-04-20T09:00:00+08:00",
        )

    def lookup_notice_change_set(
        self,
        query: NoticeChangeSetLookupQuery,
    ) -> CampusNoticeChangeSetLookupResult:
        from campus_contracts import (
            NoticeChangeSet,
            NoticeChangeSetEffectiveWindow,
            NoticeChangeSetFact,
            NoticeChangeSetQueryScope,
            NoticeChangeSetSafetySummary,
            NoticeChangeSetSourceRef,
        )

        self.last_change_set_query = query
        return CampusNoticeChangeSetLookupResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            change_set=NoticeChangeSet(
                change_set_id="notice-change-set:353903:2026-05-07",
                target_family="transport_schedule",
                query_scope=NoticeChangeSetQueryScope(
                    route_labels=("丰台到海淀通勤车",),
                    service_date="2026-05-07",
                ),
                effective_window=NoticeChangeSetEffectiveWindow(
                    starts_at="2026-05-07T00:00:00+08:00",
                    timezone="Asia/Shanghai",
                    current_at_query_time=True,
                ),
                change_kind="stop_or_boarding_point_change",
                answer_eligible=True,
                admission_state="answer_eligible",
                content_hash="sha256:test",
                facts=(
                    NoticeChangeSetFact(
                        fact_id="fact:353903",
                        fact_kind="stop_changed",
                        change_text="丰台校区乘车点调整至南门外停车区。",
                        source_notice_id="353903",
                        source_ref_id="notice-ref:353903",
                    ),
                ),
                source_refs=(
                    NoticeChangeSetSourceRef(
                        source_ref_id="notice-ref:353903",
                        notice_id="353903",
                        title="关于通勤班车丰台校区乘车点调整的通知",
                        source_url="https://portal.example.edu/notices/353903",
                        published_at="2026-05-07T08:00:00+08:00",
                    ),
                ),
                safety_summary=NoticeChangeSetSafetySummary(
                    payload_key_names=(
                        "schema_version",
                        "query_scope",
                        "effective_window",
                        "facts",
                        "source_refs",
                    )
                ),
            ),
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
        request = CapabilityRequest(
            capability="notice",
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

        bounded = execute_notice_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="campus_notice_discover",
                arguments={
                    "query_text": "春假通知",
                    "temporal_query": {
                        "mode": "current_year",
                        "as_of": "",
                        "year_hint": "2026",
                    },
                },
                call_id="call-notice-discover-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["notice_card_count"], 1)
        self.assertEqual(
            bounded["titles"],
            ["2026 年春假安排通知"],
        )
        self.assertEqual(bounded["source_ref_count"], 1)
        self.assertEqual(
            query_service.last_discover_query,
            NoticeDiscoverQuery(
                payload=CampusNoticeDiscoverPayload(
                    query_text="春假通知",
                    temporal_query=TemporalQuery(
                        mode="current_year",
                        as_of="",
                        year_hint="2026",
                    ),
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
        response = run_notice_get_internal_request(
            CapabilityRequest(
                capability="notice",
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

    def test_http_query_service_decodes_notice_change_set_result(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "query_text": "今天丰台到海淀通勤车乘车点有没有调整",
                "outcome": "resolved_current",
                "change_set": {
                    "schema_version": "notice-change-set-v1",
                    "change_set_id": "notice-change-set:353903:2026-05-07",
                    "target_family": "transport_schedule",
                    "query_scope": {
                        "service_kind": "transport_schedule",
                        "route_labels": ["丰台到海淀通勤车"],
                        "service_date": "2026-05-07",
                    },
                    "effective_window": {
                        "starts_at": "2026-05-07T00:00:00+08:00",
                        "timezone": "Asia/Shanghai",
                        "current_at_query_time": True,
                    },
                    "change_kind": "stop_or_boarding_point_change",
                    "answer_eligible": True,
                    "admission_state": "answer_eligible",
                    "content_hash": "sha256:test",
                    "facts": [
                        {
                            "fact_id": "fact:353903",
                            "fact_kind": "stop_changed",
                            "change_text": "丰台校区乘车点调整至南门外停车区。",
                            "source_notice_id": "353903",
                            "source_ref_id": "notice-ref:353903",
                            "confidence": "deterministic",
                        }
                    ],
                    "source_refs": [
                        {
                            "source_ref_id": "notice-ref:353903",
                            "notice_id": "353903",
                            "title": "关于通勤班车丰台校区乘车点调整的通知",
                            "source_url": "https://portal.example.edu/notices/353903",
                            "published_at": "2026-05-07T08:00:00+08:00",
                        }
                    ],
                    "conflicts": [],
                    "safety_summary": {
                        "raw_payload_absent": True,
                        "payload_key_names": [
                            "schema_version",
                            "query_scope",
                            "effective_window",
                            "facts",
                            "source_refs",
                        ],
                        "redacted": False,
                        "notes": ["bounded_transport_notice_override"],
                    },
                },
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_notice_change_set(
            NoticeChangeSetLookupQuery(
                payload=CampusNoticeChangeSetLookupPayload(
                    query_text="今天丰台到海淀通勤车乘车点有没有调整",
                    route_labels=("丰台到海淀通勤车",),
                    service_date="2026-05-07",
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(result.outcome, "resolved_current")
        self.assertIsNotNone(result.change_set)
        assert result.change_set is not None
        self.assertEqual(result.change_set.change_kind, "stop_or_boarding_point_change")

    def test_notice_change_set_tool_returns_nested_projection_contract(self) -> None:
        query_service = _FakeNoticeQueryService()
        request = CapabilityRequest(
            capability="notice",
            user_goal="2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
            payload=CampusNoticeChangeSetLookupPayload(
                query_text="2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
                route_labels=("丰台到海淀通勤车",),
                service_date="2026-05-07",
                query_time_anchor="today",
            ),
            allowed_tools=("campus_notice_change_set_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    entitlement_groups=("students",),
                ),
            ),
        )

        bounded = execute_notice_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="campus_notice_change_set_lookup",
                arguments={
                    "query_text": "2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
                    "route_labels": ["丰台到海淀通勤车"],
                    "service_date": "2026-05-07",
                    "query_time_anchor": "today",
                },
                call_id="call-notice-change-set-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        change_set = bounded["change_set"]
        self.assertIsInstance(change_set, dict)
        assert isinstance(change_set, dict)
        self.assertEqual(change_set["change_set_id"], "notice-change-set:353903:2026-05-07")
        self.assertEqual(change_set["change_kind"], "stop_or_boarding_point_change")
        self.assertEqual(
            change_set["facts"][0]["change_text"],
            "丰台校区乘车点调整至南门外停车区。",
        )

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
            base_url="http://execution-control.internal",
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
            "http://execution-control.internal/internal/query/notices/discover",
        )
        self.assertEqual(transport.calls[0][1]["x-execution-query-auth"], "query-secret")
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

    def test_http_query_service_rejects_discover_result_without_query_text(self) -> None:
        query_service = NoticeHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            transport=_RecordingNoticeHTTPTransport(
                {
                    "outcome": "resolved_current",
                    "source_families": ["internal_notice_restricted"],
                    "notice_cards": [
                        {
                            "notice_id": "355222",
                            "title": "中央民族大学丰台校区家具采购项目比选公告",
                            "source_family": "internal_notice_restricted",
                            "source_url": "https://portal.example.edu/notices/355222",
                        }
                    ],
                }
            ),
        )

        with self.assertRaisesRegex(RuntimeError, "query_text"):
            query_service.discover_notice(
                NoticeDiscoverQuery(
                    payload=CampusNoticeDiscoverPayload(query_text="家具采购"),
                    access_context=_restricted_access_context(),
                )
            )

    def test_http_query_service_posts_get_payload_and_decodes_card_first_result(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "notice_id": "355222",
                "outcome": "resolved_current",
                "title": "中央民族大学丰台校区家具采购项目比选公告",
                "source_family": "internal_notice_restricted",
                "source_url": "https://portal.example.edu/notices/355222",
                "canonical_url": "https://portal.example.edu/notices/355222",
                "normalized_body": "# 采购公告\n\n供应商应按要求投标。\n",
                "display_policy": {
                    "public_surface": "bounded_summary",
                    "full_body_forbidden": True,
                    "body_access": "internal_context_only",
                },
                "body_excerpt": "供应商应按要求投标。",
                "bounded_summary": "家具采购项目比选公告已发布。",
                "extracted_facts": ["采购项目为丰台校区家具。"],
                "published_at": "2026-04-12",
                "effective_at": "2026-04-12",
                "target_surface": "notice_level_query",
                "attachment_refs": ["attachment:355222:1"],
                "provenance_refs": ["notice:muc_internal_portal:355222"],
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://execution-control.internal",
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
            "http://execution-control.internal/internal/query/notices/get",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["notice_id"], "355222")
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.normalized_body, "# 采购公告\n\n供应商应按要求投标。\n")
        self.assertEqual(
            result.display_policy,
            NoticeDisplayPolicy(
                public_surface="bounded_summary",
                full_body_forbidden=True,
                body_access="internal_context_only",
            ),
        )
        self.assertEqual(result.body_excerpt, "供应商应按要求投标。")
        self.assertEqual(result.bounded_summary, "家具采购项目比选公告已发布。")
        self.assertEqual(result.extracted_facts, ("采购项目为丰台校区家具。",))
        self.assertEqual(result.target_surface, "notice_level_query")
        self.assertEqual(result.attachment_refs, ("attachment:355222:1",))

    def test_http_query_service_rejects_get_result_without_identity_fields(self) -> None:
        query_service = NoticeHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            transport=_RecordingNoticeHTTPTransport(
                {
                    "outcome": "resolved_current",
                    "title": "中央民族大学丰台校区家具采购项目比选公告",
                    "source_url": "https://portal.example.edu/notices/355222",
                }
            ),
        )

        with self.assertRaisesRegex(RuntimeError, "notice_id"):
            query_service.get_notice(
                NoticeGetQuery(
                    payload=CampusNoticeGetPayload(
                        notice_id="355222",
                        source_family="internal_notice_restricted",
                    ),
                    access_context=_restricted_access_context(),
                )
            )

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
            base_url="http://execution-control.internal",
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

    def test_notice_get_internal_result_returns_source_url_answer_without_body(self) -> None:
        response = run_notice_get_internal_request(
            CapabilityRequest(
                capability="notice",
                user_goal="读取这条公众号通知",
                payload=CampusNoticeGetPayload(
                    notice_id="wechat:article:001",
                    source_family="wechat_public_notice",
                ),
                allowed_tools=(),
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
        self.assertIn("原文链接", response.answer_text)
        self.assertIn("https://mp.weixin.qq.com/s/example", response.answer_text)
        self.assertNotIn("春假时间为 5 月 1 日至 5 月 5 日", response.answer_text)

    def test_notice_get_internal_result_never_emits_normalized_body(self) -> None:
        response = run_notice_get_internal_request(
            CapabilityRequest(
                capability="notice",
                user_goal="读取这条通知",
                payload=CampusNoticeGetPayload(
                    notice_id="notice:2026-spring-holiday",
                    source_family="official_web_public_notice",
                ),
                allowed_tools=(),
            ),
            query_service=_FakeNoticeQueryService(),
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("2026 年春假安排通知", response.answer_text)
        self.assertIn("https://campus.example/notices/spring-holiday", response.answer_text)
        self.assertNotIn("春假时间为 5 月 1 日至 5 月 5 日", response.answer_text)
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        self.assertEqual(response.capability_observability.selected_tool, "")


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
