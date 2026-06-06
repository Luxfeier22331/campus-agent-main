# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.test_campus_services_agent_support import *


class CampusServicesAgentTestPart02(unittest.TestCase):
    def test_service_guide_full_guide_response_combines_all_fact_groups(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校园卡丢了怎么办",
                guide_focus="full_guide",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:campus-card:lost-reissue",
                    display_name="校园卡挂失与补卡",
                    aliases=("校园卡丢了",),
                    category="campus_card",
                    campus_scope="all",
                    audience=("student",),
                ),
                procedure_groups=(
                    ServiceGuideProcedureGroup(
                        group_id="service:campus-card:lost-reissue:procedure_group:lost-reissue",
                        title="挂失与补卡流程",
                        focus_tags=("挂失", "补卡"),
                        steps=(
                            ServiceGuideProcedureStep(
                                step_id="service:campus-card:lost-reissue:step:report-loss",
                                content="先通过民大通办理挂失。",
                                source_refs=("official_web:campus-card",),
                            ),
                            ServiceGuideProcedureStep(
                                step_id="service:campus-card:lost-reissue:step:reissue",
                                content="再到自助补卡机补卡。",
                                source_refs=("official_web:campus-card",),
                            ),
                        ),
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                required_materials=(
                    ServiceGuideMaterial(
                        name="本人有效证件",
                        required=True,
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                entry_refs=(
                    ServiceGuideEntryRef(
                        label="学生自助补卡机",
                        entry_type="offline_location",
                        location_ref="中慧楼二层",
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                office_hours=(
                    ServiceGuideOfficeHours(
                        label="卡务中心",
                        day_pattern="工作日",
                        time_range="09:00-17:00",
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                contact_refs=(
                    ServiceGuideContactRef(
                        label="海淀校区校园卡管理中心",
                        phone="010-68933381",
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                eligibility_notes=("学生和教职工均可办理。",),
                source_refs=("official_web:campus-card",),
                queried_time_anchor="2026-04-26T10:30:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="campus_card",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("挂失与补卡流程", response.answer_text)
        self.assertIn("本人有效证件", response.answer_text)
        self.assertIn("学生自助补卡机", response.answer_text)
        self.assertIn("09:00-17:00", response.answer_text)
        self.assertIn("010-68933381", response.answer_text)
        self.assertIn("学生和教职工均可办理", response.answer_text)

    def test_service_guide_information_disclosure_response_exposes_all_source_urls(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="信息公开申请怎么提交",
                guide_focus="full_guide",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:official-web:information-disclosure-application",
                    display_name="中央民族大学信息公开依申请公开工作流程",
                    aliases=("信息公开申请",),
                    category="information_disclosure",
                    campus_scope="all",
                    audience=("student",),
                ),
                procedure_groups=(
                    ServiceGuideProcedureGroup(
                        group_id=(
                            "service:official-web:information-disclosure-application:"
                            "procedure_group:submit"
                        ),
                        title="申请流程",
                        focus_tags=("申请", "提交"),
                        steps=(
                            ServiceGuideProcedureStep(
                                step_id=(
                                    "service:official-web:information-disclosure-application:"
                                    "step:fill-form"
                                ),
                                content="申请人填写申请表后提交学校信息公开办公室。",
                                source_refs=("https://xxgk.muc.edu.cn/info/1007/1113.htm",),
                            ),
                        ),
                        source_refs=("https://xxgk.muc.edu.cn/info/1007/1113.htm",),
                    ),
                ),
                required_materials=(
                    ServiceGuideMaterial(
                        name="中央民族大学信息公开申请表",
                        required=True,
                        source_refs=("https://xxgk.muc.edu.cn/info/1007/1114.htm",),
                    ),
                ),
                entry_refs=(
                    ServiceGuideEntryRef(
                        label="信息公开申请表下载页",
                        entry_type="online_url",
                        url="https://xxgk.muc.edu.cn/info/1007/1114.htm",
                        source_refs=("https://xxgk.muc.edu.cn/info/1007/1114.htm",),
                    ),
                ),
                source_refs=(
                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                ),
                queried_time_anchor="2026-05-04T10:30:00+08:00",
                effective_from="2026-05-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="information_disclosure",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("申请人填写申请表", response.answer_text)
        self.assertIn("中央民族大学信息公开申请表", response.answer_text)
        self.assertIn("https://xxgk.muc.edu.cn/info/1007/1113.htm", response.answer_text)
        self.assertIn("https://xxgk.muc.edu.cn/info/1007/1114.htm", response.answer_text)

    def test_missing_query_service_returns_error_response(self) -> None:
        with self.assertRaisesRegex(AttributeError, "lookup_service_status"):
            execute_campus_services_sdk_tool(  # type: ignore[arg-type]
                OpenAIAgentsToolInvocation(
                    name="service_status_lookup",
                    arguments={"subject_query": "图书馆今天开门吗"},
                    call_id="call-service-status-missing-query",
                ),
                agent_request=AgentRequest(
                    target="campus-services-agent",
                    user_goal="图书馆今天开门吗",
                    payload=ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
                    allowed_tools=("service_status_lookup",),
                ),
                query_service=None,
            )

    def test_transport_schedule_response_uses_selected_departure_wording(self) -> None:
        response = transport_schedule_response(
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
        response = transport_schedule_response(
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
        response = transport_schedule_response(
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
        response = transport_schedule_response(
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

    def test_transport_schedule_status_response_shapes_operational_notice_safely(self) -> None:
        response = transport_schedule_response(
            TransportScheduleLookupResult(
                query_text="今天地铁接驳车是不是停运了",
                intent="service_window",
                outcome="resolved_current",
                resolved_route=TransportRouteRef(
                    route_id="route:subway-shuttle",
                    display_name="地铁接驳车",
                    service_family="subway_shuttle",
                ),
                service_status="temporarily_suspended",
                queried_time_anchor="2026-04-24T10:30:00+08:00",
                requested_service_date="2026-04-24",
                operational_notices=(
                    TransportOperationalNotice(
                        notice_id="353903",
                        source_ref="notice:muc_internal_portal:353903",
                        notice_kind="temporary_suspension",
                        route_ids=("route:subway-shuttle",),
                        effective_from="2026-04-24T00:00:00+08:00",
                        operational_comment="地铁接驳车今日暂停运行",
                    ),
                    TransportOperationalNotice(
                        notice_id="353904",
                        source_ref="notice:muc_internal_portal:353904",
                        notice_kind="temporary_suspension",
                        route_ids=("route:subway-shuttle",),
                        effective_from="2026-04-24T00:00:00+08:00",
                        operational_comment="地铁接驳车今日暂停运行",
                    ),
                ),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("地铁接驳车", response.answer_text)
        self.assertIn("临时停运", response.answer_text)
        self.assertIn("运营提示：地铁接驳车今日暂停运行。", response.answer_text)
        self.assertNotIn("temporarily_suspended", response.answer_text)
        self.assertNotIn("353903", response.answer_text)
        self.assertEqual(response.answer_text.count("地铁接驳车今日暂停运行"), 1)

    def test_http_query_service_posts_transport_schedule_payload_and_decodes_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
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
                "operational_notices": [
                    {
                        "notice_id": "353903",
                        "source_ref": "notice:muc_internal_portal:353903",
                        "notice_kind": "boarding_point_change",
                        "route_ids": ["route:haidian-to-fengtai"],
                        "effective_from": "2026-04-25T00:00:00+08:00",
                        "operational_comment": "海淀校区乘车点临时调整至东门",
                    }
                ],
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-gateway.internal",
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
            "http://execution-gateway.internal/internal/query/campus-services/transport-schedule",
        )
        self.assertEqual(transport.calls[0][1]["x-supervisor-query-auth"], "query-secret")
        self.assertEqual(transport.calls[0][2]["payload"]["intent"], "first_departure")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(transport.calls[0][3], 0.75)
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_route.display_name, "海淀到丰台通勤车")
        self.assertEqual(result.selected_departure.departure_at, "2026-04-25T06:50:00+08:00")
        self.assertEqual(result.operational_notices[0].notice_kind, "boarding_point_change")
        self.assertEqual(
            result.operational_notices[0].operational_comment,
            "海淀校区乘车点临时调整至东门",
        )

    def test_http_query_service_posts_service_status_payload_and_decodes_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
            {
                "subject_query": "通勤班车丰台校区乘车点现在在哪里",
                "outcome": "resolved_current",
                "resolved_subject": "两校区通勤班车丰台校区乘车点",
                "observed_status": "limited_service",
                "status_note": (
                    "下周一（12月15日）起，两校区通勤班车丰台校区的上车点、"
                    "下车点更改为聚雅餐厅东侧停车场路口"
                ),
                "queried_time_anchor": "2026-04-27T12:07:36+08:00",
                "effective_from": "2025-12-15T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "override_source_refs": ["notice:muc_internal_portal:353903"],
                "related_notice_refs": ["notice:muc_internal_portal:353903"],
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-gateway.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_service_status(
            ServiceStatusQuery(
                payload=ServiceStatusLookupPayload(
                    subject_query="通勤班车丰台校区乘车点现在在哪里",
                    campus_scope="fengtai",
                )
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://execution-gateway.internal/internal/query/campus-services/service-status",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["campus_scope"], "fengtai")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.observed_status, "limited_service")
        self.assertIn("聚雅餐厅东侧停车场路口", result.status_note)

    def test_http_query_service_posts_service_guide_payload_and_decodes_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
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
                        "section_id": "service:handbook:check-in:section:procedure",
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
                "field_status": {"contact": "source_not_provided"},
                "matched_service_category": "student_housing",
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-gateway.internal",
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
            "http://execution-gateway.internal/internal/query/campus-services/service-guide",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["guide_focus"], "procedure")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_service.display_name, "公寓楼新生办理入住手续流程")
        self.assertEqual(result.field_status, {"contact": "source_not_provided"})
        self.assertEqual(result.matched_service_category, "student_housing")

    def test_http_query_service_posts_contact_directory_payload_and_decodes_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
            {
                "query_text": "研究生院招生办公室电话是多少",
                "contact_focus": "phone",
                "outcome": "resolved_current",
                "resolved_contact": {
                    "contact_id": "contact:grad-admission-office",
                    "display_name": "研究生院招生办公室",
                    "aliases": ["研究生招生办"],
                    "entity_type": "department",
                    "department": "研究生院",
                    "contact_group": "招生咨询",
                    "campus_scope": "haidian",
                    "audience": ["student", "faculty"],
                },
                "contact_points": [
                    {
                        "channel_type": "phone",
                        "label": "招生咨询",
                        "value": "010-68930001",
                        "normalized_value": "01068930001",
                        "source_refs": ["handbook:contact-directory:2026#page=261"],
                    }
                ],
                "source_refs": ["handbook:contact-directory:2026#page=261"],
                "queried_time_anchor": "2026-04-27T10:30:00+08:00",
                "field_status": {"office_hours": "source_not_provided"},
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://execution-gateway.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_contact_directory(
            ContactDirectoryQuery(
                payload=ContactDirectoryLookupPayload(
                    query_text="研究生院招生办公室电话是多少",
                    contact_focus="phone",
                )
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://execution-gateway.internal/internal/query/campus-services/contact-directory",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["contact_focus"], "phone")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_contact.display_name, "研究生院招生办公室")
        self.assertEqual(result.contact_points[0].value, "010-68930001")
        self.assertEqual(result.field_status, {"office_hours": "source_not_provided"})

    def test_http_query_service_rejects_missing_echo_fields_instead_of_request_fallback(
        self,
    ) -> None:
        cases = (
            (
                "service status query result missing required field: subject_query",
                {
                    "outcome": "resolved_current",
                    "resolved_subject": "两校区通勤班车丰台校区乘车点",
                    "observed_status": "limited_service",
                },
                lambda service: service.lookup_service_status(
                    ServiceStatusQuery(
                        payload=ServiceStatusLookupPayload(
                            subject_query="通勤班车丰台校区乘车点现在在哪里",
                        )
                    )
                ),
            ),
            (
                "service guide query result missing required field: service_query",
                {
                    "guide_focus": "procedure",
                    "outcome": "resolved_current",
                    "resolved_service": {
                        "service_id": "service:handbook:check-in",
                        "display_name": "公寓楼新生办理入住手续流程",
                    },
                    "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                },
                lambda service: service.lookup_service_guide(
                    ServiceGuideQuery(
                        payload=ServiceGuideLookupPayload(
                            service_query="宿舍入住怎么办理",
                            guide_focus="procedure",
                        )
                    )
                ),
            ),
            (
                "service guide query result missing required field: guide_focus",
                {
                    "service_query": "宿舍入住怎么办理",
                    "outcome": "resolved_current",
                    "resolved_service": {
                        "service_id": "service:handbook:check-in",
                        "display_name": "公寓楼新生办理入住手续流程",
                    },
                    "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                },
                lambda service: service.lookup_service_guide(
                    ServiceGuideQuery(
                        payload=ServiceGuideLookupPayload(
                            service_query="宿舍入住怎么办理",
                            guide_focus="procedure",
                        )
                    )
                ),
            ),
            (
                "contact directory query result missing required field: query_text",
                {
                    "contact_focus": "phone",
                    "outcome": "resolved_current",
                    "resolved_contact": {
                        "contact_id": "contact:grad-admission-office",
                        "display_name": "研究生院招生办公室",
                    },
                    "contact_points": [
                        {
                            "channel_type": "phone",
                            "label": "招生咨询",
                            "value": "010-68930001",
                            "source_refs": ["handbook:contact-directory:2026#page=261"],
                        }
                    ],
                    "source_refs": ["handbook:contact-directory:2026#page=261"],
                },
                lambda service: service.lookup_contact_directory(
                    ContactDirectoryQuery(
                        payload=ContactDirectoryLookupPayload(
                            query_text="研究生院招生办公室电话是多少",
                            contact_focus="phone",
                        )
                    )
                ),
            ),
            (
                "contact directory query result missing required field: contact_focus",
                {
                    "query_text": "研究生院招生办公室电话是多少",
                    "outcome": "resolved_current",
                    "resolved_contact": {
                        "contact_id": "contact:grad-admission-office",
                        "display_name": "研究生院招生办公室",
                    },
                    "contact_points": [
                        {
                            "channel_type": "phone",
                            "label": "招生咨询",
                            "value": "010-68930001",
                            "source_refs": ["handbook:contact-directory:2026#page=261"],
                        }
                    ],
                    "source_refs": ["handbook:contact-directory:2026#page=261"],
                },
                lambda service: service.lookup_contact_directory(
                    ContactDirectoryQuery(
                        payload=ContactDirectoryLookupPayload(
                            query_text="研究生院招生办公室电话是多少",
                            contact_focus="phone",
                        )
                    )
                ),
            ),
            (
                "transport schedule query result missing required field: query_text",
                {
                    "intent": "first_departure",
                    "outcome": "resolved_current",
                    "resolved_route": {
                        "route_id": "route:haidian-to-fengtai",
                        "display_name": "海淀到丰台通勤车",
                        "service_family": "intercampus_commute",
                    },
                },
                lambda service: service.lookup_transport_schedule(
                    TransportScheduleQuery(
                        payload=TransportScheduleLookupPayload(
                            query_text="我明天早上要去丰台上课，最早的班车是几点",
                            intent="first_departure",
                        )
                    )
                ),
            ),
            (
                "transport schedule query result missing required field: intent",
                {
                    "query_text": "我明天早上要去丰台上课，最早的班车是几点",
                    "outcome": "resolved_current",
                    "resolved_route": {
                        "route_id": "route:haidian-to-fengtai",
                        "display_name": "海淀到丰台通勤车",
                        "service_family": "intercampus_commute",
                    },
                },
                lambda service: service.lookup_transport_schedule(
                    TransportScheduleQuery(
                        payload=TransportScheduleLookupPayload(
                            query_text="我明天早上要去丰台上课，最早的班车是几点",
                            intent="first_departure",
                        )
                    )
                ),
            ),
        )
        for error_message, response_body, call in cases:
            with self.subTest(error_message=error_message):
                query_service = CampusServicesHTTPQueryService(
                    base_url="http://execution-gateway.internal",
                    shared_secret="query-secret",
                    transport=RecordingQueryHTTPTransport(response_body),
                )
                with self.assertRaisesRegex(RuntimeError, error_message):
                    call(query_service)
