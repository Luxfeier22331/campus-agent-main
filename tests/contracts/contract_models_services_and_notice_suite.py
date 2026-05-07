from __future__ import annotations

import json
from pathlib import Path

from tests.contracts.contract_models_test_support import *

VPN_GROUPED_PROCEDURE_FIXTURE_PATH = Path(
    "tests/fixtures/service_guide_vpn_grouped_procedure_result.json"
)


class ContractModelsServicesAndNoticeSuite(unittest.TestCase):
    def test_academic_calendar_payload_and_result_serialize(self) -> None:
        payload = AcademicCalendarLookupPayload(
            query_text="今天第几教学周",
            temporal_query=TemporalQuery(mode="current"),
        )
        result = AcademicCalendarLookupResult(
            query_text="今天第几教学周",
            outcome="resolved_current",
            resolved_date="2026-05-04",
            academic_year_label="2025-2026学年",
            term_label="春季学期",
            week_index=12,
            day_kind="teaching_day",
            source_refs=("official_web:muc-academic-calendar-2025-2026:owver",),
        )

        self.assertEqual(asdict(payload)["query_text"], "今天第几教学周")
        self.assertEqual(asdict(result)["week_index"], 12)
        self.assertEqual(asdict(result)["academic_year_label"], "2025-2026学年")

    def test_academic_calendar_result_requires_source_refs_when_resolved(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "source_refs must not be empty for resolved academic calendar",
        ):
            AcademicCalendarLookupResult(
                query_text="今天第几教学周",
                outcome="resolved_current",
                resolved_date="2026-05-04",
                week_index=12,
            )

    def test_session_summary_exposes_selected_notice_ref_field(self) -> None:
        summary = SessionSummary(
            selected_notice_ref=SelectedNoticeRef(
                notice_id="notice:muc-spring-break-2026",
                source_family="official_web_public_notice",
                title="2026年春假安排通知",
            ),
            turn_count=2,
        )

        self.assertIn("selected_notice_ref", {field.name for field in fields(SessionSummary)})
        self.assertEqual(
            asdict(summary)["selected_notice_ref"]["notice_id"],
            "notice:muc-spring-break-2026",
        )

    def test_agent_request_serializes_forward_agent_allowed_tools(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="图书馆今天开门吗",
            payload=ServiceStatusLookupPayload(
                subject_query="图书馆今天开门吗",
                temporal_query=TemporalQuery(mode="current"),
            ),
            allowed_tools=("service_status_lookup",),
        )

        payload = asdict(request)

        self.assertEqual(payload["target"], "campus-services-agent")
        self.assertEqual(tuple(payload["allowed_tools"]), ("service_status_lookup",))

    def test_agent_request_rejects_unknown_allowed_tool(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "unsupported allowed_tool: transport_notice_latest"
        ):
            AgentRequest(
                target="campus-services-agent",
                user_goal="校车现在开吗",
                payload=TransportScheduleLookupPayload(
                    query_text="校车现在开吗",
                    intent="service_window",
                ),
                allowed_tools=("transport_notice_latest",),  # type: ignore[arg-type]
            )

    def test_agent_request_accepts_contact_directory_allowed_tool(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="招生办电话是多少",
            payload=ContactDirectoryLookupPayload(
                query_text="招生办电话是多少",
                contact_focus="phone",
            ),
            allowed_tools=("contact_directory_lookup",),
        )

        self.assertEqual(request.allowed_tools, ("contact_directory_lookup",))

    def test_agent_request_accepts_academic_calendar_as_campus_service_tool(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="今天第几教学周",
            payload=AcademicCalendarLookupPayload(
                query_text="今天第几教学周",
                temporal_query=TemporalQuery(mode="current"),
            ),
            allowed_tools=("academic_calendar_lookup",),
        )

        self.assertEqual(request.allowed_tools, ("academic_calendar_lookup",))

    def test_agent_request_rejects_retired_calendar_agent_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported agent target: calendar-agent"):
            AgentRequest(
                target="calendar-agent",  # type: ignore[arg-type]
                user_goal="今天第几教学周",
                payload=AcademicCalendarLookupPayload(query_text="今天第几教学周"),
                allowed_tools=("academic_calendar_lookup",),
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

    def test_service_status_payload_and_result_serialize(self) -> None:
        payload = ServiceStatusLookupPayload(
            subject_query="图书馆今天开门吗",
            temporal_query=TemporalQuery(mode="current"),
            campus_scope="haidian",
        )
        result = ServiceStatusLookupResult(
            subject_query="图书馆今天开门吗",
            outcome="resolved_current",
            resolved_subject="海淀校区图书馆",
            observed_status="open",
            status_note="工作日开放，节假日另行通知",
            queried_time_anchor="2026-04-21T10:30:00+08:00",
            effective_from="2026-04-21T08:00:00+08:00",
            effective_until="2026-04-21T22:00:00+08:00",
            override_source_refs=("notice:muc-library-holiday-adjustment-2026",),
            related_notice_refs=("notice:muc-library-holiday-adjustment-2026",),
        )

        self.assertEqual(
            asdict(payload),
            {
                "subject_query": "图书馆今天开门吗",
                "temporal_query": {
                    "mode": "current",
                    "as_of": "",
                    "year_hint": "",
                },
                "campus_scope": "haidian",
            },
        )
        self.assertEqual(asdict(result)["observed_status"], "open")
        self.assertEqual(asdict(result)["status_note"], "工作日开放，节假日另行通知")
        self.assertEqual(
            tuple(asdict(result)["override_source_refs"]),
            ("notice:muc-library-holiday-adjustment-2026",),
        )

    def test_service_guide_payload_and_result_serialize(self) -> None:
        payload = ServiceGuideLookupPayload(
            service_query="宿舍入住怎么办理",
            guide_focus="procedure",
            temporal_query=TemporalQuery(mode="current"),
            audience="student",
        )
        result = ServiceGuideLookupResult(
            service_query="宿舍入住怎么办理",
            guide_focus="procedure",
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

        self.assertEqual(asdict(payload)["guide_focus"], "procedure")
        self.assertEqual(
            asdict(result)["resolved_service"]["display_name"], "公寓楼新生办理入住手续流程"
        )
        self.assertEqual(
            tuple(asdict(result)["source_refs"]),
            ("handbook:student_rules:pages:252-255#page=253",),
        )
        self.assertEqual(asdict(result)["field_status"], {"contact": "source_not_provided"})

    def test_service_guide_contract_exposes_grouped_procedure_and_focus_metadata(self) -> None:
        result_fields = {field.name for field in fields(ServiceGuideLookupResult)}
        self.assertTrue(
            {
                "procedure_groups",
                "selected_section_ids",
                "omitted_section_ids",
                "omitted_section_reasons",
            }.issubset(result_fields)
        )
        self.assertIn("section_id", {field.name for field in fields(ServiceGuideSection)})

    def test_service_guide_vpn_grouped_procedure_fixture_matches_contract(self) -> None:
        payload = json.loads(VPN_GROUPED_PROCEDURE_FIXTURE_PATH.read_text(encoding="utf-8"))
        procedure_groups = tuple(
            ServiceGuideProcedureGroup(
                group_id=str(group["group_id"]),
                title=str(group["title"]),
                focus_tags=tuple(group.get("focus_tags") or ()),
                steps=tuple(
                    ServiceGuideProcedureStep(
                        step_id=str(step["step_id"]),
                        content=str(step["content"]),
                        source_refs=tuple(step.get("source_refs") or ()),
                    )
                    for step in (group.get("steps") or [])
                ),
                source_refs=tuple(group.get("source_refs") or ()),
            )
            for group in payload["procedure_groups"]
        )
        result = ServiceGuideLookupResult(
            service_query=str(payload["service_query"]),
            guide_focus=str(payload["guide_focus"]),
            outcome=str(payload["outcome"]),
            resolved_service=ServiceGuideServiceRef(
                service_id=str(payload["resolved_service"]["service_id"]),
                display_name=str(payload["resolved_service"]["display_name"]),
                aliases=tuple(payload["resolved_service"].get("aliases") or ()),
                category=str(payload["resolved_service"]["category"]),
                campus_scope=str(payload["resolved_service"]["campus_scope"]),
                audience=tuple(payload["resolved_service"].get("audience") or ()),
            ),
            guide_sections=tuple(
                ServiceGuideSection(
                    section_id=str(section["section_id"]),
                    section_type=str(section["section_type"]),
                    title=str(section["title"]),
                    content=str(section["content"]),
                    source_refs=tuple(section.get("source_refs") or ()),
                )
                for section in payload["guide_sections"]
            ),
            procedure_groups=procedure_groups,
            source_refs=tuple(payload["source_refs"]),
            queried_time_anchor=str(payload["queried_time_anchor"]),
            effective_from=str(payload["effective_from"]),
            effective_until=str(payload["effective_until"]),
            matched_service_category=str(payload["matched_service_category"]),
            selected_section_ids=tuple(payload["selected_section_ids"]),
            omitted_section_ids=tuple(payload["omitted_section_ids"]),
            omitted_section_reasons=dict(payload["omitted_section_reasons"]),
            field_status=dict(payload["field_status"]),
        )

        rendered = asdict(result)
        self.assertEqual(
            rendered["procedure_groups"][0]["group_id"],
            "service:official_web:vpn:procedure_group:client_install",
        )
        self.assertEqual(
            tuple(rendered["selected_section_ids"]),
            ("service:official_web:vpn:procedure_group:client_install",),
        )
        self.assertEqual(
            tuple(rendered["omitted_section_ids"]),
            (
                "service:official_web:vpn:procedure_group:direct_login",
                "service:official_web:vpn:procedure_group:mobile_usage",
            ),
        )
        self.assertEqual(
            rendered["omitted_section_reasons"][
                "service:official_web:vpn:procedure_group:direct_login"
            ],
            "focus_mismatch",
        )

    def test_service_guide_result_requires_fail_close_reason(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "fail_close_reason must not be empty for fail-closed service guide results",
        ):
            ServiceGuideLookupResult(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
                outcome="temporarily_unverifiable",
            )

    def test_contact_directory_payload_and_result_serialize(self) -> None:
        payload = ContactDirectoryLookupPayload(
            query_text="招生办电话是多少",
            contact_focus="phone",
            campus_scope="haidian",
            audience="student",
            result_limit=3,
        )
        result = ContactDirectoryLookupResult(
            query_text="招生办电话是多少",
            contact_focus="phone",
            outcome="resolved_current",
            resolved_contact=ContactDirectoryContactRef(
                contact_id="contact:admission-office",
                display_name="招生办公室",
                aliases=("招生办",),
                entity_type="office",
                department="本科招生办公室",
                contact_group="招生",
                campus_scope="haidian",
                audience=("student",),
            ),
            contact_points=(
                ContactDirectoryContactPoint(
                    channel_type="phone",
                    label="咨询电话",
                    value="010-68930001",
                    source_refs=("handbook:student_rules:pages:261-261#page=261",),
                ),
            ),
            office_hours=(
                ContactDirectoryOfficeHours(
                    hours_id="hours:admission-office",
                    label="办公时间",
                    day_pattern="工作日",
                    time_range="08:30-11:30,14:00-17:00",
                    source_refs=("handbook:student_rules:pages:261-261#page=261",),
                ),
            ),
            source_refs=("handbook:student_rules:pages:261-261#page=261",),
            field_status={"email": "source_not_provided"},
        )

        self.assertEqual(asdict(payload)["contact_focus"], "phone")
        self.assertEqual(asdict(result)["resolved_contact"]["display_name"], "招生办公室")
        self.assertEqual(asdict(result)["contact_points"][0]["channel_type"], "phone")
        self.assertEqual(asdict(result)["field_status"], {"email": "source_not_provided"})

    def test_field_not_provided_by_source_is_canonical_fail_close_reason(self) -> None:
        result = ServiceGuideLookupResult(
            service_query="公费医疗报销联系电话是多少",
            guide_focus="contact",
            outcome="temporarily_unverifiable",
            fail_close_reason="field_not_provided_by_source",
            field_status={"contact": "source_not_provided"},
        )

        self.assertEqual(result.fail_close_reason, "field_not_provided_by_source")

    def test_contact_directory_result_requires_fail_close_reason(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "fail_close_reason must not be empty for fail-closed contact directory results",
        ):
            ContactDirectoryLookupResult(
                query_text="招生办电话是多少",
                contact_focus="phone",
                outcome="temporarily_unverifiable",
            )

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
                    source_url="https://www.muc.edu.cn/info/2025-spring-break.htm",
                    canonical_url="https://www.muc.edu.cn/info/2025-spring-break.htm",
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
            title="中央民族大学丰台校区家具采购项目比选公告",
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

    def test_service_status_historical_result_allows_missing_downgrade_reason(self) -> None:
        result = ServiceStatusLookupResult(
            subject_query="2024年图书馆开放状态",
            outcome="resolved_historical_reference",
            resolved_subject="海淀校区图书馆",
            observed_status="closed",
        )

        self.assertEqual(result.outcome, "resolved_historical_reference")
        self.assertEqual(result.historical_downgrade_reason, "")

    def test_notice_discover_historical_result_allows_missing_downgrade_reason(self) -> None:
        result = CampusNoticeDiscoverResult(
            query_text="2024年春假通知",
            outcome="resolved_historical_reference",
            notice_cards=(
                NoticeCard(
                    notice_id="notice:muc-spring-break-2024",
                    title="2024年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://www.muc.edu.cn/info/2024-spring-break.htm",
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
            source_url="https://www.muc.edu.cn/info/2024-spring-break.htm",
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
            source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
        )

        self.assertEqual(result.normalized_body, "")
        self.assertEqual(result.display_policy.public_surface, "card_only")
        self.assertTrue(result.display_policy.full_body_forbidden)

    def test_notice_get_result_allows_reference_only_resolved_notice_without_body(self) -> None:
        result = CampusNoticeGetResult(
            notice_id="wechat:notice:muc:001",
            outcome="resolved_current",
            title="关于讲座安排的通知",
            source_family="wechat_public_notice",
            source_url="https://mp.weixin.qq.com/s/example",
            reference_only=True,
        )

        self.assertTrue(result.reference_only)
        self.assertEqual(result.normalized_body, "")

    def test_notice_context_projection_rejects_raw_body_fields(self) -> None:
        projection = NoticeContextProjection(
            projection_id="projection:notice_context:abc123",
            notice_ref=SelectedNoticeRef(
                notice_id="notice:muc-spring-break-2026",
                source_family="official_web_public_notice",
                title="2026年春假安排通知",
            ),
            content_hash="sha256:abc123",
            source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
            body_excerpt="春假安排短摘要。",
            bounded_summary="该通知说明春假安排，以官方链接为准。",
            extracted_facts=("春假安排以官方链接为准",),
        )

        payload = asdict(projection)

        self.assertNotIn("normalized_body", payload)
        self.assertEqual(payload["display_policy"]["public_surface"], "bounded_summary")
        self.assertTrue(payload["display_policy"]["full_body_forbidden"])

    def test_notice_display_policy_forbids_public_full_body_policy(self) -> None:
        with self.assertRaisesRegex(ValueError, "full_body_forbidden must be true"):
            NoticeDisplayPolicy(full_body_forbidden=False)

    def test_agent_request_rejects_notice_get_as_agent_facing_allowed_tool(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported allowed_tool: campus_notice_get"):
            AgentRequest(
                target="notice-agent",
                user_goal="打开这条通知",
                payload=CampusNoticeGetPayload(notice_id="notice:muc-spring-break-2026"),
                allowed_tools=("campus_notice_get",),  # type: ignore[arg-type]
            )

    def test_agent_request_accepts_service_status_payload(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="图书馆今天开门吗",
            payload=ServiceStatusLookupPayload(
                subject_query="图书馆今天开门吗",
                temporal_query=TemporalQuery(mode="current"),
            ),
        )

        self.assertEqual(
            asdict(request)["payload"],
            {
                "subject_query": "图书馆今天开门吗",
                "temporal_query": {
                    "mode": "current",
                    "as_of": "",
                    "year_hint": "",
                },
                "campus_scope": "",
            },
        )

    def test_agent_request_accepts_service_guide_payload(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="宿舍入住怎么办理",
            payload=ServiceGuideLookupPayload(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
            ),
            allowed_tools=("service_guide_lookup",),
        )

        self.assertEqual(asdict(request)["payload"]["guide_focus"], "procedure")
        self.assertEqual(tuple(asdict(request)["allowed_tools"]), ("service_guide_lookup",))

    def test_agent_response_serializes_notice_get_result_shape(self) -> None:
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="这是当前可确认的春假通知正文。",
            confidence="high",
            result=CampusNoticeGetResult(
                notice_id="notice:muc-spring-break-2026",
                title="2026年春假安排通知",
                outcome="resolved_current",
                source_family="official_web_public_notice",
                source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
                canonical_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
                body_excerpt="春假安排以官方链接为准。",
                published_at="2026-04-18",
                effective_at="2026-04-30",
                attachment_refs=("asset:notice-attachment-001",),
                provenance_refs=("projection:official_web_notice_projection_v1",),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["result"]["notice_id"], "notice:muc-spring-break-2026")
        self.assertEqual(payload["result"]["source_family"], "official_web_public_notice")
        self.assertEqual(payload["result"]["display_policy"]["public_surface"], "card_only")
        self.assertEqual(payload["result"]["normalized_body"], "")
        self.assertEqual(
            tuple(payload["result"]["attachment_refs"]),
            ("asset:notice-attachment-001",),
        )
        self.assertEqual(
            tuple(payload["result"]["provenance_refs"]),
            ("projection:official_web_notice_projection_v1",),
        )

    def test_agent_request_rejects_missing_payload(self) -> None:
        with self.assertRaises(TypeError):
            AgentRequest(  # type: ignore[call-arg]
                target="rag-agent",
                user_goal="library hours",
            )

    def test_document_ref_and_error_defaults_are_stable(self) -> None:
        document_ref = DocumentRef(
            document_id="handbook:test-001",
            revision_track="source-faithful",
            version_id="v1:test-001",
            corpus="regulations",
            collection="student_rules",
            source_uri="https://campus.example/docs/test-001",
            content_hash="sha256:test-001",
        )
        error = ErrorInfo(code="retrieval_failed", message="Qdrant timeout")

        self.assertEqual(document_ref.corpus, "regulations")
        self.assertEqual(document_ref.collection, "student_rules")
        self.assertFalse(error.retryable)
        self.assertEqual(asdict(error)["message"], "Qdrant timeout")

    def test_document_ref_accepts_campus_services_collections(self) -> None:
        navigation_ref = DocumentRef(
            document_id="service:catalog-001",
            revision_track="source-faithful",
            version_id="v1:catalog-001",
            corpus="campus_services",
            collection="service_catalog",
            source_uri="https://service.muc.edu.cn/v2/site/index",
            content_hash="sha256:catalog-001",
        )
        contact_ref = DocumentRef(
            document_id="service:contact-001",
            revision_track="source-faithful",
            version_id="v1:contact-001",
            corpus="campus_services",
            collection="contact_directory",
            source_uri="campus-agent://campus_services/contact_directory/docs/service:contact-001",
            content_hash="sha256:contact-001",
        )

        self.assertEqual(navigation_ref.corpus, "campus_services")
        self.assertEqual(navigation_ref.collection, "service_catalog")
        self.assertEqual(contact_ref.collection, "contact_directory")
