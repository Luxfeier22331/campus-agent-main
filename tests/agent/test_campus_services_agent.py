from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    ContactDirectoryContactPoint,
    ContactDirectoryContactRef,
    ContactDirectoryLocationRef,
    ContactDirectoryLookupPayload,
    ContactDirectoryLookupResult,
    ContactDirectoryOfficeHours,
    ContextProjection,
    ScheduledDeparture,
    ServiceGuideContactRef,
    ServiceGuideEntryRef,
    ServiceGuideLookupPayload,
    ServiceGuideLookupResult,
    ServiceGuideMaterial,
    ServiceGuideOfficeHours,
    ServiceGuideProcedureGroup,
    ServiceGuideProcedureStep,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    TransportOperationalNotice,
    TransportRouteRef,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
    TransportServiceWindow,
    TransportStopRef,
)
from campus_services_agent.http_query_service import CampusServicesHTTPQueryService
from campus_services_agent.query_service import (
    CampusServicesAccessContext,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)
from campus_services_agent.response_builder import (
    contact_directory_response,
    service_guide_response,
    service_status_response,
    transport_schedule_response,
)
from campus_services_agent.sdk_tool_executor import execute_campus_services_sdk_tool
from campus_supervisor_agent_worker.agents_sdk_runner import AgentsSdkToolExecutionRequest

from tests.agent.campus_services_agent_fakes import (
    FakeCampusServicesQueryService,
    RecordingQueryHTTPTransport,
)


class CampusServicesAgentTest(unittest.TestCase):
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
            AgentsSdkToolExecutionRequest(
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
                AgentsSdkToolExecutionRequest(
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
            AgentsSdkToolExecutionRequest(
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
        self.assertEqual(bounded["resolved_service"], {"display_name": "公寓楼新生办理入住手续流程"})
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
            AgentsSdkToolExecutionRequest(
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

    def test_service_guide_procedure_response_deduplicates_grouped_and_compatibility_sections(self) -> None:
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
                guide_sections=(
                    ServiceGuideSection(
                        section_id="service:campus-card:lost-reissue:section:procedure",
                        section_type="procedure",
                        title="挂失与补卡流程",
                        content="先通过民大通办理挂失，再到自助补卡机补卡。",
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
                guide_sections=(
                    ServiceGuideSection(
                        section_id="service:official-web:information-disclosure-application:section:procedure",
                        section_type="procedure",
                        title="申请流程",
                        content="申请人填写申请表后提交学校信息公开办公室。",
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
                AgentsSdkToolExecutionRequest(
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
            base_url="http://supervisor-api.internal",
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
            "http://supervisor-api.internal/internal/query/campus-services/transport-schedule",
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
            base_url="http://supervisor-api.internal",
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
            "http://supervisor-api.internal/internal/query/campus-services/service-status",
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
            base_url="http://supervisor-api.internal",
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
            "http://supervisor-api.internal/internal/query/campus-services/service-guide",
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
            base_url="http://supervisor-api.internal",
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
            "http://supervisor-api.internal/internal/query/campus-services/contact-directory",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["contact_focus"], "phone")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.resolved_contact.display_name, "研究生院招生办公室")
        self.assertEqual(result.contact_points[0].value, "010-68930001")
        self.assertEqual(result.field_status, {"office_hours": "source_not_provided"})

    def test_http_query_service_decodes_service_guide_materials_and_fail_close_reason(
        self,
    ) -> None:
        material_transport = RecordingQueryHTTPTransport(
            {
                "service_query": "公费医疗报销需要什么材料",
                "guide_focus": "required_materials",
                "outcome": "resolved_current",
                "resolved_service": {
                    "service_id": "service:handbook:student-public-medical-reimbursement",
                    "display_name": "公费医疗报销办理指南",
                    "aliases": ["公费医疗报销"],
                    "category": "student_public_medical",
                    "campus_scope": "all",
                    "audience": ["student"],
                },
                "required_materials": [
                    {
                        "name": "急诊证明",
                        "required": True,
                        "note": "急病报销需提供。",
                        "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                    },
                    {
                        "name": "住院收据",
                        "required": True,
                        "note": "住院报销需提供。",
                        "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                    },
                ],
                "source_refs": ["handbook:student_rules:pages:259-260#page=259"],
                "matched_service_category": "student_public_medical",
            }
        )
        material_query_service = CampusServicesHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            transport=material_transport,
        )

        material_result = material_query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=ServiceGuideLookupPayload(
                    service_query="公费医疗报销需要什么材料",
                    guide_focus="required_materials",
                )
            )
        )

        self.assertEqual(material_result.required_materials[0].name, "急诊证明")
        self.assertEqual(material_result.required_materials[1].name, "住院收据")
        self.assertEqual(material_result.matched_service_category, "student_public_medical")

        fail_close_transport = RecordingQueryHTTPTransport(
            {
                "service_query": "公费医疗报销联系电话是多少",
                "guide_focus": "contact",
                "outcome": "temporarily_unverifiable",
                "queried_time_anchor": "2026-04-26T10:30:00+08:00",
                "fail_close_reason": "field_not_provided_by_source",
                "field_status": {"contact": "source_not_provided"},
            }
        )
        fail_close_query_service = CampusServicesHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            transport=fail_close_transport,
        )

        fail_close_result = fail_close_query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=ServiceGuideLookupPayload(
                    service_query="公费医疗报销联系电话是多少",
                    guide_focus="contact",
                )
            )
        )

        self.assertEqual(fail_close_result.outcome, "temporarily_unverifiable")
        self.assertEqual(fail_close_result.fail_close_reason, "field_not_provided_by_source")
        self.assertEqual(fail_close_result.field_status, {"contact": "source_not_provided"})

    def test_agent_response_explains_field_not_provided_by_source(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="公费医疗报销联系电话是多少",
                guide_focus="contact",
                outcome="temporarily_unverifiable",
                fail_close_reason="field_not_provided_by_source",
                field_status={"contact": "source_not_provided"},
            )
        )

        self.assertIn("当前来源未提供联系方式", response.answer_text)
        self.assertEqual(
            response.agent_observability.safe_details["field_status"],
            {"contact": "source_not_provided"},
        )

    def test_agent_response_explains_entry_url_not_provided_by_source(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校历链接是什么",
                guide_focus="entry",
                outcome="temporarily_unverifiable",
                fail_close_reason="field_not_provided_by_source",
                field_status={"service_entry": "source_not_provided"},
            )
        )

        self.assertIn("入口链接", response.answer_text)
        self.assertNotIn("办理指南", response.answer_text)


if __name__ == "__main__":
    unittest.main()
