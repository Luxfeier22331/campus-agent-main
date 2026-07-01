# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.contracts.contract_models_services_and_notice_suite_support import *


class ContractModelsServicesAndNoticeSuitePart01(unittest.TestCase):
    def test_session_summary_exposes_selected_notice_ref_field(self) -> None:
        summary = SessionSummary(
            selected_notice_ref=SelectedNoticeRef(
                notice_id="notice:muc-spring-break-2026",
                source_family="official_web_public_notice",
                title="2026年春假安排通知",
                target_surface="regulations/student_rules",
            ),
            turn_count=2,
        )

        self.assertIn("selected_notice_ref", {field.name for field in fields(SessionSummary)})
        self.assertEqual(
            asdict(summary)["selected_notice_ref"]["notice_id"],
            "notice:muc-spring-break-2026",
        )
        self.assertEqual(
            asdict(summary)["selected_notice_ref"]["target_surface"],
            "regulations/student_rules",
        )

    def test_notice_period_summary_payload_and_result_serialize(self) -> None:
        payload = CampusNoticePeriodSummaryPayload(
            query_text="4月上旬奖学金通知总结",
            date_range=NoticeDateRange(
                start_date="2026-04-01",
                end_date="2026-04-10",
                timezone="Asia/Shanghai",
            ),
            source_families=("internal_notice_restricted",),
            target_surfaces=("notice_level_query",),
            group_by="topic",
            max_items=10,
        )
        result = CampusNoticePeriodSummaryResult(
            query_text="4月上旬奖学金通知总结",
            outcome="resolved_current",
            date_range=payload.date_range,
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

        self.assertEqual(asdict(payload)["date_range"]["start_date"], "2026-04-01")
        self.assertEqual(asdict(payload)["group_by"], "topic")
        self.assertEqual(asdict(result)["source_ref_count"], 2)
        self.assertEqual(asdict(result)["groups"][0]["group_key"], "奖学金")

    def test_notice_period_summary_rejects_invalid_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "start_date must be <= end_date"):
            NoticeDateRange(start_date="2026-04-10", end_date="2026-04-01")

    def test_tool_request_serializes_forward_allowed_tools(self) -> None:
        request = ToolRequest(
            tool="transport_schedule_lookup",
            user_goal="校车下一班几点",
            payload=TransportScheduleLookupPayload(
                query_text="校车下一班几点",
                intent="next_departure",
            ),
            allowed_tools=("transport_schedule_lookup",),
        )

        payload = asdict(request)

        self.assertEqual(payload["tool"], "transport_schedule_lookup")
        self.assertEqual(tuple(payload["allowed_tools"]), ("transport_schedule_lookup",))

    def test_agent_request_rejects_unknown_allowed_tool(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "unsupported allowed_tool: transport_notice_latest"
        ):
            ToolRequest(
                tool="transport_schedule_lookup",
                user_goal="校车现在开吗",
                payload=TransportScheduleLookupPayload(
                    query_text="校车现在开吗",
                    intent="service_window",
                ),
                allowed_tools=("transport_notice_latest",),  # type: ignore[arg-type]
            )

    def test_agent_request_rejects_closed_navigation_as_model_facing_allowed_tool(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported allowed_tool: place_lookup"):
            ToolRequest(
                tool="place_lookup",
                user_goal="图书馆在哪",
                payload=PlaceLookupPayload(query_text="图书馆在哪"),
                allowed_tools=("place_lookup",),
            )

    def test_temporal_query_requires_as_of_anchor_when_mode_is_as_of(self) -> None:
        with self.assertRaisesRegex(ValueError, "as_of is required when temporal mode is as_of"):
            TemporalQuery(mode="as_of")

    def test_temporal_query_rejects_year_hint_outside_current_year_mode(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "year_hint is only allowed when temporal mode is current_year",
        ):
            TemporalQuery(mode="current", year_hint="2026")

    def test_campus_services_tool_result_envelope_wraps_transport_schedule_facts(self) -> None:
        result = CampusServicesToolResultEnvelope(
            tool_name="transport_schedule_lookup",
            query_kind="transport_schedule",
            outcome="resolved_current",
            facts=CampusServicesScheduleFacts(
                result=TransportScheduleLookupResult(
                    query_text="校车下一班几点",
                    intent="next_departure",
                    outcome="resolved_current",
                    resolved_route=TransportRouteRef(
                        route_id="route:intercampus",
                        display_name="两校区接驳",
                        service_family="intercampus",
                    ),
                    selected_departure=ScheduledDeparture(departure_at="18:30"),
                    schedule_snapshot=TransportScheduleSnapshotRef(
                        snapshot_id="snapshot:transport:current",
                        published_at="2026-06-01T00:00:00+08:00",
                        source_ref="campus_services:transport_schedule:current",
                    ),
                )
            ),
            source_refs=("campus_services:transport_schedule:current",),
            projection_ref="projection:campus_services:transport_schedule:current",
            content_hash="sha256:transport-current",
        )

        payload = asdict(result)

        self.assertEqual(payload["schema_version"], "campus_services_tool_result.v1")
        self.assertEqual(payload["tool"], "transport_schedule_lookup")
        self.assertEqual(payload["facts"]["kind"], "schedule_facts")
        self.assertEqual(
            payload["facts"]["result"]["resolved_route"]["route_id"],
            "route:intercampus",
        )

    def test_campus_services_tool_result_envelope_rejects_raw_projection_refs(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw campus services projection key"):
            CampusServicesToolResultEnvelope(
                tool_name="transport_schedule_lookup",
                query_kind="transport_schedule",
                outcome="resolved_current",
                facts=CampusServicesScheduleFacts(
                    result=TransportScheduleLookupResult(
                        query_text="校车下一班几点",
                        intent="next_departure",
                        outcome="resolved_current",
                        resolved_route=TransportRouteRef(
                            route_id="route:intercampus",
                            display_name="两校区接驳",
                            service_family="intercampus",
                        ),
                    )
                ),
                source_refs=("campus_services:transport_schedule:current",),
                projection_ref="object_store_key:s3://raw/source",
                content_hash="sha256:transport-current",
            )

    def test_campus_services_tool_result_envelope_allows_fail_closed_without_source_refs(
        self,
    ) -> None:
        result = CampusServicesToolResultEnvelope(
            tool_name="transport_schedule_lookup",
            query_kind="transport_schedule",
            outcome="temporarily_unverifiable",
            facts=CampusServicesScheduleFacts(
                result=TransportScheduleLookupResult(
                    query_text="校车下一班几点",
                    intent="next_departure",
                    outcome="temporarily_unverifiable",
                    fail_close_reason="source_truth_unavailable",
                )
            ),
            projection_ref="projection:campus_services:transport_schedule:unavailable",
            content_hash="sha256:transport-unavailable",
            fail_close_reason="source_truth_unavailable",
        )

        self.assertEqual(asdict(result)["source_refs"], ())

    def test_transport_schedule_payload_requires_non_empty_query_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "query_text must not be empty"):
            TransportScheduleLookupPayload(query_text=" ", intent="next_departure")

    def test_transport_schedule_payload_uses_intent_first_shape(self) -> None:
        self.assertEqual(
            {field.name for field in fields(TransportScheduleLookupPayload)},
            {
                "query_text",
                "intent",
                "route_selector",
                "snapshot_query",
                "service_time_query",
                "result_limit",
            },
        )

    def test_transport_schedule_result_exposes_departure_and_snapshot_fields(self) -> None:
        self.assertTrue(
            {
                "intent",
                "selected_departure",
                "departure_options",
                "service_window",
                "schedule_snapshot",
                "candidate_routes",
                "operational_notices",
            }.issubset({field.name for field in fields(TransportScheduleLookupResult)})
        )

    def test_scheduled_departure_exposes_status_kind_note_and_source_refs(self) -> None:
        departure = ScheduledDeparture(
            departure_at="2026-06-24T07:00:00+08:00",
            departure_status="changed",
            departure_kind="student",
            operational_note="该班次临时改至南门上车",
            related_notice_refs=("https://portal.example.edu/notice/456",),
        )

        payload = asdict(departure)

        self.assertEqual(payload["departure_status"], "changed")
        self.assertEqual(payload["departure_kind"], "student")
        self.assertEqual(payload["operational_note"], "该班次临时改至南门上车")
        self.assertEqual(
            tuple(payload["related_notice_refs"]),
            ("https://portal.example.edu/notice/456",),
        )

    def test_scheduled_departure_rejects_invalid_status_and_kind(self) -> None:
        with self.assertRaises(ValueError):
            ScheduledDeparture(
                departure_at="2026-06-24T07:00:00+08:00",
                departure_status="silently_normalized",
            )
        with self.assertRaises(ValueError):
            ScheduledDeparture(
                departure_at="2026-06-24T07:00:00+08:00",
                departure_kind="vip",
            )

    def test_transport_schedule_result_serializes_stop_refs(self) -> None:
        result = TransportScheduleLookupResult(
            query_text="今天校车还有吗",
            intent="service_window",
            outcome="resolved_current",
            resolved_route=TransportRouteRef(
                route_id="route:haidian-fengtai",
                display_name="海淀校区往返丰台校区班车",
                service_family="intercampus_commute",
            ),
            service_status="running",
            queried_time_anchor="2026-04-21T18:10:00+08:00",
            requested_service_date="2026-04-21",
            service_window=TransportServiceWindow(
                first_departure_at="2026-04-21T18:30:00+08:00",
                last_departure_at="2026-04-21T19:00:00+08:00",
            ),
            stop_refs=(
                TransportStopRef(
                    stop_id="stop:haidian-main-gate",
                    display_name="海淀校区南门",
                ),
                TransportStopRef(
                    stop_id="stop:fengtai-main-gate",
                    display_name="丰台校区南门",
                ),
            ),
            related_notice_refs=("notice:school-bus-spring-2026",),
        )

        payload = asdict(result)

        self.assertEqual(payload["intent"], "service_window")
        self.assertEqual(payload["service_status"], "running")
        self.assertEqual(payload["resolved_route"]["display_name"], "海淀校区往返丰台校区班车")
        self.assertEqual(payload["stop_refs"][0]["display_name"], "海淀校区南门")
        self.assertEqual(
            tuple(payload["related_notice_refs"]),
            ("notice:school-bus-spring-2026",),
        )

    def test_notice_discover_result_serializes_historical_downgrade(self) -> None:
        result = CampusNoticeDiscoverResult(
            query_text="2026年春假通知",
            outcome="resolved_historical_reference",
            source_families=("official_web_public_notice",),
            notice_cards=(
                NoticeCard(
                    notice_id="notice:muc-spring-break-2025",
                    title="2025年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://www.example.edu/info/2025-spring-break.htm",
                    canonical_url="https://www.example.edu/info/2025-spring-break.htm",
                    summary="当前年份未命中，仅返回上一年度相关通知作为历史参考。",
                    published_at="2025-03-01",
                    effective_at="2025-03-10",
                    is_current=False,
                ),
            ),
            historical_downgrade_reason="current_year_miss",
        )

        payload = asdict(result)

        self.assertEqual(payload["outcome"], "resolved_historical_reference")
        self.assertEqual(payload["historical_downgrade_reason"], "current_year_miss")
        self.assertEqual(
            payload["notice_cards"][0]["source_family"],
            "official_web_public_notice",
        )

    def test_notice_source_family_accepts_wechat_public_notice(self) -> None:
        card = NoticeCard(
            notice_id="wechat:article:001",
            title="关于校园活动的通知",
            source_family="wechat_public_notice",
            source_url="https://mp.weixin.qq.com/s/example",
            target_surface="notice_level_query",
        )
        discover = CampusNoticeDiscoverPayload(
            query_text="校园活动",
            source_families=("wechat_public_notice",),
        )
        get_payload = CampusNoticeGetPayload(
            notice_id="wechat:article:001",
            source_family="wechat_public_notice",
        )

        self.assertEqual(card.source_family, "wechat_public_notice")
        self.assertEqual(card.target_surface, "notice_level_query")
        self.assertEqual(discover.source_families, ("wechat_public_notice",))
        self.assertEqual(get_payload.source_family, "wechat_public_notice")

    def test_notice_card_and_get_result_carry_minimum_web_card_surface(self) -> None:
        card = NoticeCard(
            notice_id="355222",
            title="示例大学丰台校区家具采购项目比选公告",
            source_family="internal_notice_restricted",
            source_url="https://portal.example.edu/notices/355222",
            canonical_url="https://portal.example.edu/notices/355222",
            target_surface="notice_level_query",
            published_at="2026-04-12",
        )
        result = CampusNoticeGetResult(
            notice_id="355222",
            outcome="resolved_current",
            title=card.title,
            source_family=card.source_family,
            source_url=card.source_url,
            canonical_url=card.canonical_url,
            target_surface=card.target_surface,
            published_at=card.published_at,
            display_policy=NoticeDisplayPolicy(public_surface="card_only"),
        )

        self.assertEqual(card.target_surface, "notice_level_query")
        self.assertEqual(result.target_surface, "notice_level_query")
        self.assertEqual(result.display_policy.public_surface, "card_only")
        self.assertTrue(result.display_policy.full_body_forbidden)

    def test_notice_discover_historical_result_allows_missing_downgrade_reason(self) -> None:
        result = CampusNoticeDiscoverResult(
            query_text="2024年春假通知",
            outcome="resolved_historical_reference",
            notice_cards=(
                NoticeCard(
                    notice_id="notice:muc-spring-break-2024",
                    title="2024年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://www.example.edu/info/2024-spring-break.htm",
                ),
            ),
        )

        self.assertEqual(result.outcome, "resolved_historical_reference")
        self.assertEqual(result.historical_downgrade_reason, "")

    def test_notice_get_historical_result_allows_missing_downgrade_reason(self) -> None:
        result = CampusNoticeGetResult(
            notice_id="notice:muc-spring-break-2024",
            outcome="resolved_historical_reference",
            title="2024年春假安排通知",
            source_family="official_web_public_notice",
            source_url="https://www.example.edu/info/2024-spring-break.htm",
        )

        self.assertEqual(result.outcome, "resolved_historical_reference")
        self.assertEqual(result.historical_downgrade_reason, "")

    def test_notice_get_result_does_not_require_normalized_body_for_resolved_notice(
        self,
    ) -> None:
        result = CampusNoticeGetResult(
            notice_id="notice:muc-spring-break-2026",
            title="2026年春假安排通知",
            outcome="resolved_current",
            source_family="official_web_public_notice",
            source_url="https://www.example.edu/info/2026-spring-break.htm",
        )

        self.assertEqual(result.normalized_body, "")
        self.assertEqual(result.display_policy.public_surface, "card_only")
        self.assertTrue(result.display_policy.full_body_forbidden)


if __name__ == "__main__":
    unittest.main()
