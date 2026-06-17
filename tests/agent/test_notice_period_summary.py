from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticePeriodSummaryPayload,
    CampusNoticePeriodSummaryResult,
    CapabilityRequest,
    ContextProjection,
    NoticeCard,
    NoticeDateRange,
    NoticePeriodSummaryGroup,
    WorkflowCapabilityContext,
)
from campus_notice_capability.http_query_service import NoticeHTTPQueryService
from campus_notice_capability.query_service import (
    NoticeAccessContext,
    NoticePeriodSummaryQuery,
)
from campus_notice_capability.sdk_tool_executor import execute_notice_sdk_tool

from tests.agent.tool_invocation_support import ToolInvocation

OpenAIAgentsToolInvocation = ToolInvocation


class _FakeNoticePeriodSummaryQueryService:
    def __init__(self) -> None:
        self.last_period_summary_query: NoticePeriodSummaryQuery | None = None

    def summarize_notice_period(
        self,
        query: NoticePeriodSummaryQuery,
    ) -> CampusNoticePeriodSummaryResult:
        self.last_period_summary_query = query
        return CampusNoticePeriodSummaryResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            date_range=query.payload.date_range,
            groups=(
                NoticePeriodSummaryGroup(
                    group_key="奖学金",
                    title="奖学金",
                    notice_count=2,
                    summary="4月上旬有奖学金申请和答辩安排两类通知。",
                    notice_ids=("notice-001", "notice-002"),
                ),
            ),
            notice_cards=(
                NoticeCard(
                    notice_id="notice-001",
                    title="关于开展奖学金申请工作的通知",
                    source_family="internal_notice_restricted",
                    source_url="https://portal.example.edu/notices/notice-001",
                    target_surface="notice_level_query",
                    published_at="2026-04-02T09:00:00+08:00",
                    summary="奖学金申请材料提交安排。",
                ),
            ),
            bounded_summary="4月上旬有奖学金申请和答辩安排两类通知。",
            source_ref_count=2,
        )


class NoticePeriodSummaryAgentTest(unittest.TestCase):
    def test_http_query_service_posts_notice_period_summary_payload(self) -> None:
        transport = _RecordingNoticeHTTPTransport(
            {
                "query_text": "4月上旬奖学金通知总结",
                "outcome": "resolved_current",
                "date_range": {
                    "start_date": "2026-04-01",
                    "end_date": "2026-04-10",
                    "timezone": "Asia/Shanghai",
                },
                "groups": [
                    {
                        "group_key": "奖学金",
                        "title": "奖学金",
                        "notice_count": 2,
                        "summary": "4月上旬有奖学金申请和答辩安排两类通知。",
                        "notice_ids": ["notice-001", "notice-002"],
                    }
                ],
                "notice_cards": [
                    {
                        "notice_id": "notice-001",
                        "title": "关于开展奖学金申请工作的通知",
                        "source_family": "internal_notice_restricted",
                        "source_url": "https://portal.example.edu/notices/notice-001",
                        "target_surface": "notice_level_query",
                        "published_at": "2026-04-02T09:00:00+08:00",
                        "summary": "奖学金申请材料提交安排。",
                    }
                ],
                "bounded_summary": "4月上旬有奖学金申请和答辩安排两类通知。",
                "source_ref_count": 2,
                "display_policy": {
                    "public_surface": "bounded_summary",
                    "full_body_forbidden": True,
                    "body_access": "none",
                },
            }
        )
        query_service = NoticeHTTPQueryService(
            base_url="http://execution-control.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.summarize_notice_period(
            NoticePeriodSummaryQuery(
                payload=CampusNoticePeriodSummaryPayload(
                    query_text="4月上旬奖学金通知总结",
                    date_range=NoticeDateRange(
                        start_date="2026-04-01",
                        end_date="2026-04-10",
                    ),
                    source_families=("internal_notice_restricted",),
                    target_surfaces=("notice_level_query",),
                    group_by="topic",
                    max_items=10,
                ),
                access_context=_restricted_access_context(),
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://execution-control.internal/internal/query/notices/period-summary",
        )
        self.assertEqual(
            transport.calls[0][2]["payload"]["date_range"]["start_date"],
            "2026-04-01",
        )
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.groups[0].group_key, "奖学金")
        self.assertEqual(result.source_ref_count, 2)
        self.assertTrue(result.display_policy.full_body_forbidden)

    def test_notice_period_summary_tool_returns_bounded_projection(self) -> None:
        query_service = _FakeNoticePeriodSummaryQueryService()
        request = _period_summary_request()

        bounded = execute_notice_sdk_tool(
            _period_summary_invocation("call-notice-period-summary-001"),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["source_ref_count"], 2)
        self.assertEqual(
            bounded["bounded_summary"],
            "4月上旬有奖学金申请和答辩安排两类通知。",
        )
        self.assertEqual(bounded["groups"][0]["group_key"], "奖学金")
        self.assertEqual(
            query_service.last_period_summary_query,
            NoticePeriodSummaryQuery(
                payload=CampusNoticePeriodSummaryPayload(
                    query_text="总结 4 月上旬奖学金通知",
                    date_range=NoticeDateRange(
                        start_date="2026-04-01",
                        end_date="2026-04-10",
                        timezone="Asia/Shanghai",
                    ),
                    source_families=("internal_notice_restricted",),
                    target_surfaces=("notice_level_query",),
                    group_by="topic",
                    max_items=10,
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

    def test_notice_period_summary_tool_attaches_output_projection_ref(self) -> None:
        query_service = _FakeNoticePeriodSummaryQueryService()
        request = _period_summary_request(
            workflow_context=WorkflowCapabilityContext(
                workflow_run_ref="run-notice-period-summary",
                step_id="sdk_tool.execute.campus_notice_period_summary.1",
                capability_id="notice",
                expected_output_artifacts=("notice_period_summary",),
            )
        )

        bounded = execute_notice_sdk_tool(
            _period_summary_invocation("call-notice-period-summary-projection-001"),
            agent_request=request,
            query_service=query_service,
        )

        projection_ref = bounded.get("output_projection_ref")
        self.assertIsInstance(projection_ref, dict)
        assert isinstance(projection_ref, dict)
        self.assertEqual(projection_ref["projection_kind"], "notice_period_summary")
        self.assertEqual(
            projection_ref["source_step_id"],
            "sdk_tool.execute.campus_notice_period_summary.1",
        )
        self.assertTrue(
            str(projection_ref["projection_id"]).startswith("projection:notice_period_summary:")
        )


def _period_summary_request(
    *,
    workflow_context: WorkflowCapabilityContext | None = None,
) -> CapabilityRequest:
    kwargs: dict[str, object] = {}
    if workflow_context is not None:
        kwargs["workflow_context"] = workflow_context
    return CapabilityRequest(
        capability="notice",
        user_goal="总结 4 月上旬奖学金通知",
        payload=CampusNoticePeriodSummaryPayload(
            query_text="总结 4 月上旬奖学金通知",
            date_range=NoticeDateRange(
                start_date="2026-04-01",
                end_date="2026-04-10",
            ),
        ),
        allowed_tools=("campus_notice_period_summary",),
        actor=ActorContext(user_id="student-001"),
        context=ContextProjection(
            actor=ActorContext(user_id="student-001"),
            authorization=AuthorizationProjection(
                principal_id="principal-001",
                entitlement_groups=("students",),
            ),
        ),
        **kwargs,
    )


def _period_summary_invocation(call_id: str) -> OpenAIAgentsToolInvocation:
    return OpenAIAgentsToolInvocation(
        name="campus_notice_period_summary",
        arguments={
            "query_text": "总结 4 月上旬奖学金通知",
            "date_range": {
                "start_date": "2026-04-01",
                "end_date": "2026-04-10",
                "timezone": "Asia/Shanghai",
            },
            "source_families": ["internal_notice_restricted"],
            "target_surfaces": ["notice_level_query"],
            "group_by": "topic",
            "max_items": 10,
        },
        call_id=call_id,
    )


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
