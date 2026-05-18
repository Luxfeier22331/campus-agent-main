---
doc_type: plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Service Guide Lookup Question Matrix

This matrix is the denominator for the workstream. Implementation may store the cases directly in
tests or convert them into a JSON fixture, but the coverage classes must remain equivalent.

## Case Schema

- `case_id`: stable identifier
- `user_goal`: user-facing Chinese question
- `expected_tool`: expected structured tool or boundary owner
- `expected_guide_focus`: expected focus when `expected_tool=service_guide_lookup`
- `expected_outcome`: `resolved_current`, `clarification_required`, `temporarily_unverifiable`,
  `no_answer` or boundary-specific completed outcome
- `must_contain`: user-visible answer tokens or structured fields that must appear
- `must_not_contain`: forbidden tokens, unrelated facts or internal/debug vocabulary
- `fixture_strategy`: `current_source_truth`, `existing_runtime_fixture`,
  `synthetic_runtime_fixture`, `public_chat_fixture` or `boundary_fixture`
- `layers`: implementation layers that must cover the case

## Positive Service Guide Cases

| Case | User Goal | Tool | Focus | Outcome | Must Contain | Must Not Contain | Fixture Strategy | Layers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sg-entry-calendar-url | 校历在哪里看 | service_guide_lookup | entry | resolved_current | 校历入口; `https://www.muc.edu.cn/ggfw/mdxl.htm` | 当前没有找到; source_refs; release_id | existing_runtime_fixture | planner; runtime; agent; app-api; eval; public-chat |
| sg-entry-calendar-url-short | 校历网址是什么 | service_guide_lookup | entry | resolved_current | `https://www.muc.edu.cn/ggfw/mdxl.htm` | 第几教学周; 办理步骤 | existing_runtime_fixture | planner; runtime; agent |
| sg-entry-vpn-login | VPN 去哪里登录 | service_guide_lookup | entry | resolved_current | `https://vpn.muc.edu.cn` | 安装步骤; 所需材料 | existing_runtime_fixture | planner; runtime; agent; app-api; eval; public-chat |
| sg-entry-network-auth | 校园网认证网址是什么 | service_guide_lookup | entry | resolved_current | 认证; 入口 | 客户端安装; source_refs | existing_runtime_fixture | planner; runtime; agent |
| sg-entry-information-disclosure | 信息公开申请表在哪里下载 | service_guide_lookup | entry | resolved_current | 信息公开申请表; 下载 | 17步; raw | existing_runtime_fixture | planner; runtime; agent; eval |
| sg-procedure-campus-card-loss | 校园卡丢了怎么办 | service_guide_lookup | procedure | resolved_current | 补卡; 校园卡 | 当前没有找到; source_refs | current_source_truth | planner; runtime; agent; app-api; eval; public-chat |
| sg-procedure-vpn-client | VPN 客户端怎么安装 | service_guide_lookup | procedure | resolved_current | 客户端; 安装 | `https://vpn.muc.edu.cn` 作为唯一答案; 所需材料 | existing_runtime_fixture | planner; runtime; agent; eval |
| sg-procedure-transport-booking | 地铁接驳车怎么预约 | service_guide_lookup | procedure | resolved_current | 预约 | 班次列表; 下一班 | synthetic_runtime_fixture | planner; runtime; agent |
| sg-procedure-dorm-checkin | 宿舍入住怎么办理 | service_guide_lookup | procedure | resolved_current | 公寓楼; 报到 | 电话是多少; source_refs | current_source_truth | planner; runtime; agent |
| sg-materials-medical-reimbursement | 公费医疗报销需要什么材料 | service_guide_lookup | required_materials | resolved_current | 急诊证明; 住院收据 | 联系电话; 办理时间 | current_source_truth | planner; runtime; agent; app-api; eval; public-chat |
| sg-materials-information-disclosure | 信息公开申请要准备什么 | service_guide_lookup | required_materials | resolved_current | 申请表; 申请材料 | 电话是多少; 全部流程 | existing_runtime_fixture | planner; runtime; agent |
| sg-materials-dorm-withdrawal | 本科生退宿需要什么材料 | service_guide_lookup | required_materials | resolved_current | 退宿; 材料 | 校历; 班车 | synthetic_runtime_fixture | planner; runtime |
| sg-contact-medical | 公费医疗报销联系电话是多少 | service_guide_lookup | contact | resolved_current | 电话; 公费医疗 | 所需材料; source_refs | synthetic_runtime_fixture | planner; runtime; agent |
| sg-contact-information-disclosure | 信息公开申请联系电话是多少 | service_guide_lookup | contact | resolved_current | 信息公开; 电话 | 入口步骤; release_id | synthetic_runtime_fixture | planner; runtime; agent |
| sg-contact-campus-card-phone | 校园卡管理中心电话是多少 | service_guide_lookup | contact | resolved_current | 010-68933381; 010-83878225 | 邮箱冒充电话; source_refs | current_source_truth | planner; runtime; agent |
| sg-hours-campus-card | 校园卡补办办公时间是什么 | service_guide_lookup | office_hours | resolved_current | 办公时间; 校园卡 | 所需材料; 班车 | synthetic_runtime_fixture | planner; runtime; agent |
| sg-hours-card-center-colloquial | 卡务中心几点上班 | service_guide_lookup | office_hours | resolved_current | 卡务中心; 时间 | source_refs; release_id | synthetic_runtime_fixture | planner; runtime; agent |
| sg-eligibility-campus-card | 校园卡补办哪些人能办 | service_guide_lookup | eligibility | resolved_current | 正式卡; 临时卡 | 办理入口作为唯一答案 | current_source_truth | planner; runtime; agent |
| sg-eligibility-medical | 公费医疗哪些学生能享受 | service_guide_lookup | eligibility | resolved_current | 公费医疗; 学生 | 报销材料列表作为唯一答案 | current_source_truth | planner; runtime; agent |
| sg-full-guide-campus-card | 校园卡服务有哪些内容 | service_guide_lookup | full_guide | resolved_current | 校园卡 | release_id; raw source | current_source_truth | planner; runtime; agent |

## Boundary And Non-Service-Guide Cases

| Case | User Goal | Expected Owner | Expected Outcome | Must Contain | Must Not Contain | Fixture Strategy | Layers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| boundary-calendar-week | 2026-05-07 是第几教学周 | academic_calendar_lookup | completed | 第10教学周 | 校历入口作为主答案 | public_chat_fixture | planner; eval; public-chat |
| boundary-calendar-holiday | 五一放几天 | academic_calendar_lookup | completed | 5 月 1 日到 5 月 5 日; 5 天 | 服务指南; 办理入口 | public_chat_fixture | planner; eval; public-chat |
| boundary-transport-next | 明天早上去丰台最早的班车是几点 | transport_schedule_lookup | planned_handoff | transport_schedule_lookup | 怎么预约作为主答案 | boundary_fixture | planner; eval |
| boundary-status-card-center | 卡务中心今天开不开 | service_status_lookup | planned_handoff | service_status_lookup | 补卡材料作为主答案 | boundary_fixture | planner; eval |
| boundary-contact-directory | 研究生院招生办公室电话是多少 | contact_directory_lookup | planned_handoff | contact_directory_lookup | 办理指南 | boundary_fixture | planner; eval |
| boundary-contact-directory-information-disclosure | 信息公开联系电话是多少 | contact_directory_lookup | planned_handoff | contact_directory_lookup | 办理入口作为主答案; 申请流程作为主答案 | boundary_fixture | planner; eval |
| boundary-notice-original | 最近有哪些班车调整通知 | notice-agent:campus_notice_discover | planned_handoff | campus_notice_discover | 办理流程作为主答案 | boundary_fixture | planner; public-chat |

## Fail-Close Cases

| Case | User Goal | Tool | Focus | Expected Outcome | Must Contain | Must Not Contain | Fixture Strategy | Layers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fail-entry-source-only | 办公电话查询链接是什么 | service_guide_lookup | entry | temporarily_unverifiable | 暂时不能稳定确认入口 | source_refs 当成入口; 全流程硬答 | existing_runtime_fixture | runtime; agent; eval |
| fail-contact-department-only | 信息公开申请联系电话是多少 | service_guide_lookup | contact | temporarily_unverifiable | 暂时不能稳定确认联系方式 | 部门名冒充电话; 010-伪造 | synthetic_runtime_fixture | runtime; agent; eval |
| fail-office-hours-missing | 校园卡补办办公时间是什么 | service_guide_lookup | office_hours | temporarily_unverifiable | 暂时不能稳定确认办公时间 | 从正文猜测时间; 全天 | synthetic_runtime_fixture | runtime; agent |
| fail-materials-missing | 信息公开申请要准备什么 | service_guide_lookup | required_materials | temporarily_unverifiable | 暂时不能稳定确认所需材料 | 流程步骤冒充材料 | synthetic_runtime_fixture | runtime; agent |
| fail-eligibility-missing | 公费医疗哪些学生能享受 | service_guide_lookup | eligibility | temporarily_unverifiable | 暂时不能稳定确认适用范围 | 报销材料冒充资格 | synthetic_runtime_fixture | runtime; agent |
| fail-transaction-request | 帮我预约地铁接驳车 | guarded_terminal | none | guarded_refusal | 不能代办; 不能预约 | service_guide_lookup execution handoff; 已预约 | boundary_fixture | planner; agent; app-api; eval |

## Layer Ownership

- Planner:
  `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- Structured runtime:
  `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`
- Agent answer shaping:
  `tests/agent/test_campus_services_agent.py`
- App-api public answer rendering:
  `apps/app-api/test/chat-command.service.core.structured.suite.ts`
- Public-chat entry fixture:
  `packages/evals/fixtures/public_chat_entry_cases.v1.json`
- Release gate:
  `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`
  `tests/evals/service_guide_lookup_release_gate_suite.py`

## Fixture Strategy Rules

- `current_source_truth` means the case should use already admitted service-guide source truth.
- `existing_runtime_fixture` means current Go/Python/eval fixtures already contain the necessary
  fact shape; implementation should reuse or normalize them.
- `synthetic_runtime_fixture` means the behavior is tested with explicit synthetic projection rows
  and does not request new source collection or selected-write release.
- `public_chat_fixture` means the case belongs in representative public-chat entry fixtures.
- `boundary_fixture` means the case verifies routing/guardrail ownership and does not require
  service-guide runtime lookup.
