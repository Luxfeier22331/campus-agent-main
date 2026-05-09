# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.test_campus_services_agent_support import *


class CampusServicesAgentTestPart01(unittest.TestCase):
    def test_service_status_payload_routes_through_internal_query_service(self) -> None:
        query_service = FakeCampusServicesQueryService()
        request = AgentRequest(
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

        bounded = execute_campus_services_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="service_status_lookup",
                arguments={"subject_query": "图书馆今天开门吗"},
                call_id="call-service-status-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["subject_query"], "图书馆今天开门吗")
        self.assertEqual(bounded["resolved_subject"], "海淀校区图书馆")
        self.assertEqual(bounded["observed_status"], "open")
        self.assertEqual(bounded["source_ref_count"], 1)
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

    def test_service_status_response_renders_open_ended_effective_window(self) -> None:
        response = service_status_response(
            ServiceStatusLookupResult(
                subject_query="静园10号楼女浴室",
                outcome="resolved_current",
                resolved_subject="静园10号楼负一层女浴室",
                observed_status="limited_service",
                status_note=(
                    "静园10号楼负一层女浴室目前已建成（见图1），将于本周四（4月16日）试运行"
                ),
                queried_time_anchor="2026-04-28T11:05:00+08:00",
                effective_from="2026-04-16T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                override_source_refs=("notice:muc_internal_portal:355650",),
                related_notice_refs=("notice:muc_internal_portal:355650",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("静园10号楼负一层女浴室", response.answer_text)
        self.assertIn("有限开放", response.answer_text)
        self.assertIn("有效时间：4月16日 00:00 起。", response.answer_text)
        self.assertNotIn("2099", response.answer_text)
        self.assertNotIn("12月31日", response.answer_text)

    def test_transport_schedule_payload_rejects_tool_outside_allowed_tools(self) -> None:
        with self.assertRaisesRegex(TypeError, "unexpected keyword argument"):
            execute_campus_services_sdk_tool(
                OpenAIAgentsToolInvocation(
                    name="service_status_lookup",
                    arguments={"query_text": "校车什么时候发车", "intent": "next_departure"},
                    call_id="call-invalid-001",
                ),
                agent_request=AgentRequest(
                    target="campus-services-agent",
                    user_goal="校车什么时候发车",
                    payload=TransportScheduleLookupPayload(
                        query_text="校车什么时候发车",
                        intent="next_departure",
                    ),
                    allowed_tools=("service_status_lookup",),
                ),
                query_service=FakeCampusServicesQueryService(),
            )

    def test_transport_schedule_payload_normalizes_null_nested_fields(self) -> None:
        query_service = FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="校车最早几点发车",
            payload=TransportScheduleLookupPayload(
                query_text="校车最早几点发车",
                intent="first_departure",
            ),
            allowed_tools=("transport_schedule_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        bounded = execute_campus_services_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="transport_schedule_lookup",
                arguments={
                    "query_text": "校车最早几点发车",
                    "intent": "first_departure",
                    "route_selector": {
                        "route_id": None,
                        "service_family": None,
                        "route_variant_query": None,
                        "origin_campus": None,
                        "destination_campus": None,
                        "origin_stop_query": None,
                        "destination_stop_query": None,
                    },
                    "snapshot_query": {
                        "mode": None,
                        "as_of": None,
                        "year_hint": None,
                    },
                    "service_time_query": {
                        "date_mode": None,
                        "service_date": None,
                        "daypart": None,
                        "departure_not_before": None,
                        "departure_not_after": None,
                    },
                    "result_limit": None,
                },
                call_id="call-transport-0001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(
            query_service.last_transport_schedule_query.payload.query_text, "校车最早几点发车"
        )
        self.assertEqual(
            query_service.last_transport_schedule_query.payload.intent, "first_departure"
        )

    def test_service_guide_payload_routes_through_internal_query_service(self) -> None:
        query_service = FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="宿舍入住怎么办理",
            payload=ServiceGuideLookupPayload(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
            ),
            allowed_tools=("service_guide_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        bounded = execute_campus_services_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="service_guide_lookup",
                arguments={
                    "service_query": "宿舍入住怎么办理",
                    "guide_focus": "procedure",
                },
                call_id="call-service-guide-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["service_query"], "宿舍入住怎么办理")
        self.assertEqual(
            bounded["resolved_service"], {"display_name": "公寓楼新生办理入住手续流程"}
        )
        self.assertEqual(
            query_service.last_service_guide_query.payload.service_query,
            "宿舍入住怎么办理",
        )

    def test_contact_directory_payload_routes_through_internal_query_service(self) -> None:
        query_service = FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="研究生院招生办公室电话是多少",
            payload=ContactDirectoryLookupPayload(
                query_text="研究生院招生办公室电话是多少",
                contact_focus="phone",
            ),
            allowed_tools=("contact_directory_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        bounded = execute_campus_services_sdk_tool(
            OpenAIAgentsToolInvocation(
                name="contact_directory_lookup",
                arguments={
                    "query_text": "研究生院招生办公室电话是多少",
                    "contact_focus": "phone",
                },
                call_id="call-contact-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["contact_focus"], "phone")
        self.assertEqual(
            bounded["resolved_contact"],
            {"display_name": "研究生院招生办公室"},
        )
        self.assertEqual(
            query_service.last_contact_directory_query.payload.query_text,
            "研究生院招生办公室电话是多少",
        )

    def test_contact_directory_all_contacts_response_combines_available_fact_groups(self) -> None:
        response = contact_directory_response(
            ContactDirectoryLookupResult(
                query_text="研究生院招生办公室联系方式",
                contact_focus="all_contacts",
                outcome="resolved_current",
                resolved_contact=ContactDirectoryContactRef(
                    contact_id="contact:grad-admission-office",
                    display_name="研究生院招生办公室",
                    aliases=("研究生招生办",),
                    entity_type="department",
                    department="研究生院",
                    contact_group="招生咨询",
                    campus_scope="haidian",
                    audience=("student",),
                ),
                contact_points=(
                    ContactDirectoryContactPoint(
                        channel_type="phone",
                        label="招生咨询电话",
                        value="010-68930001",
                        normalized_value="01068930001",
                        source_refs=("official_web:graduate-school:contact",),
                    ),
                    ContactDirectoryContactPoint(
                        channel_type="email",
                        label="招生邮箱",
                        value="admission@muc.edu.cn",
                        normalized_value="admission@muc.edu.cn",
                        source_refs=("official_web:graduate-school:contact",),
                    ),
                ),
                location_refs=(
                    ContactDirectoryLocationRef(
                        label="办公室",
                        location_ref="海淀校区研究生院",
                        address_text="海淀校区研究生院楼201",
                        source_refs=("official_web:graduate-school:contact",),
                    ),
                ),
                office_hours=(
                    ContactDirectoryOfficeHours(
                        hours_id="hours:grad-admission-office",
                        label="办公时间",
                        day_pattern="工作日",
                        time_range="09:00-17:00",
                        source_refs=("official_web:graduate-school:contact",),
                    ),
                ),
                source_refs=("official_web:graduate-school:contact",),
                queried_time_anchor="2026-04-27T10:30:00+08:00",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("010-68930001", response.answer_text)
        self.assertIn("admission@muc.edu.cn", response.answer_text)
        self.assertIn("海淀校区研究生院楼201", response.answer_text)
        self.assertIn("09:00-17:00", response.answer_text)

    def test_service_guide_contact_response_includes_contact_channels(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校医院电话是多少",
                guide_focus="contact",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:handbook:student-public-medical-reimbursement",
                    display_name="公费医疗报销办理指南",
                    aliases=("公费医疗报销",),
                    category="student_public_medical",
                    campus_scope="all",
                    audience=("student",),
                ),
                contact_refs=(
                    ServiceGuideContactRef(
                        label="校医院",
                        department="校医院",
                        phone="68930000",
                        email="hospital@example.edu",
                        source_refs=("handbook:student_rules:pages:261-261#page=261",),
                    ),
                ),
                source_refs=("handbook:student_rules:pages:261-261#page=261",),
                queried_time_anchor="2026-04-26T10:30:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="student_public_medical",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("校医院", response.answer_text)
        self.assertIn("68930000", response.answer_text)
        self.assertIn("hospital@example.edu", response.answer_text)

    def test_service_guide_material_response_includes_material_names(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="公费医疗报销需要什么材料",
                guide_focus="required_materials",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:handbook:student-public-medical-reimbursement",
                    display_name="公费医疗报销办理指南",
                    aliases=("公费医疗报销",),
                    category="student_public_medical",
                    campus_scope="all",
                    audience=("student",),
                ),
                required_materials=(
                    ServiceGuideMaterial(
                        name="急诊证明",
                        required=True,
                        note="假期急病门诊报销和急病住院报销均需提供。",
                        source_refs=("handbook:student_rules:pages:259-260#page=259",),
                    ),
                    ServiceGuideMaterial(
                        name="住院收据",
                        required=True,
                        note="急病住院报销需提供。",
                        source_refs=("handbook:student_rules:pages:259-260#page=259",),
                    ),
                ),
                source_refs=("handbook:student_rules:pages:259-260#page=259",),
                queried_time_anchor="2026-04-26T10:30:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="student_public_medical",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("公费医疗报销办理指南", response.answer_text)
        self.assertIn("急诊证明", response.answer_text)
        self.assertIn("住院收据", response.answer_text)

    def test_service_guide_procedure_response_renders_selected_vpn_group_only(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="VPN客户端怎么安装",
                guide_focus="procedure",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:official_web:vpn",
                    display_name="中央民族大学 VPN 使用说明",
                    aliases=("VPN",),
                    category="campus_service",
                    campus_scope="all",
                    audience=("student",),
                ),
                guide_sections=(
                    ServiceGuideSection(
                        section_id="service:official_web:vpn:section:procedure:client_install",
                        section_type="procedure",
                        title="客户端安装",
                        content="1. 首次使用请根据系统提示下载客户端。\n2. 双击 Install EasyConnect.pkg 完成安装。",
                        source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                    ),
                ),
                procedure_groups=(),
                selected_section_ids=("service:official_web:vpn:procedure_group:client_install",),
                omitted_section_ids=(
                    "service:official_web:vpn:procedure_group:direct_login",
                    "service:official_web:vpn:procedure_group:mobile_usage",
                ),
                omitted_section_reasons={
                    "service:official_web:vpn:procedure_group:direct_login": "focus_mismatch",
                    "service:official_web:vpn:procedure_group:mobile_usage": "focus_mismatch",
                },
                source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                queried_time_anchor="2026-05-04T10:30:00+08:00",
                effective_from="2026-05-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="campus_service",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("客户端安装", response.answer_text)
        self.assertIn("Install EasyConnect.pkg", response.answer_text)
        self.assertNotIn("统一身份认证账号和密码登录", response.answer_text)
        self.assertEqual(
            response.agent_observability.safe_details["selected_section_ids"],
            ["service:official_web:vpn:procedure_group:client_install"],
        )

    def test_service_guide_procedure_response_deduplicates_grouped_and_compatibility_sections(
        self,
    ) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="VPN客户端怎么安装",
                guide_focus="procedure",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:official_web:vpn",
                    display_name="中央民族大学 VPN 使用说明",
                    aliases=("VPN",),
                    category="campus_service",
                    campus_scope="all",
                    audience=("student",),
                ),
                guide_sections=(
                    ServiceGuideSection(
                        section_id="service:official_web:vpn:procedure_group:client_install",
                        section_type="procedure",
                        title="客户端安装",
                        content="1. 首次使用请根据系统提示下载客户端。\n2. 双击 Install EasyConnect.pkg 完成安装。",
                        source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                    ),
                ),
                procedure_groups=(
                    ServiceGuideProcedureGroup(
                        group_id="service:official_web:vpn:procedure_group:client_install",
                        title="客户端安装",
                        focus_tags=("client", "install", "客户端"),
                        steps=(
                            ServiceGuideProcedureStep(
                                step_id="step-1",
                                content="首次使用请根据系统提示下载客户端。",
                                source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                            ),
                            ServiceGuideProcedureStep(
                                step_id="step-2",
                                content="双击 Install EasyConnect.pkg 完成安装。",
                                source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                            ),
                        ),
                        source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                    ),
                ),
                selected_section_ids=("service:official_web:vpn:procedure_group:client_install",),
                source_refs=("https://met.muc.edu.cn/info/1046/1674.htm",),
                queried_time_anchor="2026-05-04T10:30:00+08:00",
                effective_from="2026-05-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="campus_service",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text.count("客户端安装"), 1)
        self.assertEqual(response.answer_text.count("首次使用请根据系统提示下载客户端。"), 1)
        self.assertEqual(response.answer_text.count("Install EasyConnect.pkg"), 1)

    def test_service_guide_observability_includes_focus_service_and_source_summary(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校园卡在哪里补办",
                guide_focus="entry",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:campus-card:lost-reissue",
                    display_name="校园卡挂失与补卡",
                    aliases=("校园卡丢了",),
                    category="campus_card",
                    campus_scope="all",
                    audience=("student",),
                ),
                entry_refs=(
                    ServiceGuideEntryRef(
                        label="学生自助补卡机",
                        entry_type="offline_location",
                        location_ref="中慧楼二层",
                        source_refs=("official_web:campus-card",),
                    ),
                ),
                source_refs=("official_web:campus-card", "https://ids.muc.edu.cn/campus-card"),
                selected_section_ids=("service:campus-card:lost-reissue:entry:self-service",),
                queried_time_anchor="2026-05-04T10:30:00+08:00",
                effective_from="2026-05-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="campus_card",
            )
        )

        safe_details = response.agent_observability.safe_details
        self.assertEqual(safe_details["guide_focus"], "entry")
        self.assertEqual(safe_details["resolved_service_id"], "service:campus-card:lost-reissue")
        self.assertEqual(safe_details["resolved_service_display_name"], "校园卡挂失与补卡")
        self.assertEqual(
            safe_details["source_refs_used"],
            ["official_web:campus-card", "https://ids.muc.edu.cn/campus-card"],
        )
        self.assertEqual(
            safe_details["result_guardrail"]["focus_guardrail"],
            "narrow_focus",
        )

    def test_service_guide_entry_response_uses_entry_label_and_url(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校历在哪里看",
                guide_focus="entry",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:official_web:academic-calendar-guide",
                    display_name="中央民族大学校历查看方式",
                    aliases=("校历怎么看",),
                    category="campus_service",
                    campus_scope="all",
                    audience=("student",),
                ),
                guide_sections=(
                    ServiceGuideSection(
                        section_id="service:official_web:academic-calendar-guide:section:entry",
                        section_type="entry",
                        title="查看入口",
                        content="访问中央民族大学公开校历页面查看当学年校历。",
                        source_refs=("https://met.muc.edu.cn/info/1068/1832.htm",),
                    ),
                ),
                entry_refs=(
                    ServiceGuideEntryRef(
                        label="中央民族大学公开校历",
                        entry_type="online_url",
                        url="https://www.muc.edu.cn/ggfw/mdxl.htm",
                        source_refs=("https://www.muc.edu.cn/ggfw/mdxl.htm",),
                    ),
                ),
                source_refs=(
                    "https://met.muc.edu.cn/info/1068/1832.htm",
                    "https://www.muc.edu.cn/ggfw/mdxl.htm",
                ),
                queried_time_anchor="2026-05-04T10:30:00+08:00",
                effective_from="2026-05-04T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                matched_service_category="campus_service",
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("入口", response.answer_text)
        self.assertIn("https://www.muc.edu.cn/ggfw/mdxl.htm", response.answer_text)
        self.assertNotIn("所需材料", response.answer_text)
        self.assertNotIn("办理时间", response.answer_text)


if __name__ == "__main__":
    unittest.main()
