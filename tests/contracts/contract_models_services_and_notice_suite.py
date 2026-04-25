from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsServicesAndNoticeSuite(unittest.TestCase):
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

        self.assertEqual(asdict(payload)["guide_focus"], "procedure")
        self.assertEqual(
            asdict(result)["resolved_service"]["display_name"], "公寓楼新生办理入住手续流程"
        )
        self.assertEqual(
            tuple(asdict(result)["source_refs"]),
            ("handbook:student_rules:pages:252-255#page=253",),
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
            normalized_body="历史通知正文。",
        )

        self.assertEqual(result.outcome, "resolved_historical_reference")
        self.assertEqual(result.historical_downgrade_reason, "")

    def test_notice_get_result_requires_normalized_body_for_resolved_notice(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "normalized_body must not be empty for resolved notice results",
        ):
            CampusNoticeGetResult(
                notice_id="notice:muc-spring-break-2026",
                title="2026年春假安排通知",
                outcome="resolved_current",
                source_family="official_web_public_notice",
                source_url="https://www.muc.edu.cn/info/2026-spring-break.htm",
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
                normalized_body="一、放假时间为 4 月 30 日至 5 月 5 日。",
                published_at="2026-04-18",
                effective_at="2026-04-30",
                attachment_refs=("asset:notice-attachment-001",),
                provenance_refs=("projection:official_web_notice_projection_v1",),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["result"]["notice_id"], "notice:muc-spring-break-2026")
        self.assertEqual(payload["result"]["source_family"], "official_web_public_notice")
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
