---
doc_type: boundary
status: active
created: 2026-04-28
updated: 2026-04-28
workstream: authenticated-notice-service-status-consumption
---
# Service Status Consumption Boundary

<!-- markdownlint-disable MD013 -->

## Boundary Matrix

| Candidate family | Owned by service status | Accepted examples | Rejected examples | Fail-close reason |
| --- | --- | --- | --- | --- |
| Facility / classroom / self-study / venue availability | Yes | 自习室临时关闭、场馆暂停开放、恢复开放时间 | 场馆预约流程、教室借用办法、长期管理规定 | `missing_effective_window_or_status_signal` / `service_guide_owned` |
| IT platform / portal / OA / network / card platform | Yes | 信息门户维护、校园网暂停、VPN 服务恢复、一卡通平台停服 | 操作说明、账号申请流程、平台使用指南 | `missing_effective_window_or_status_signal` / `service_guide_owned` |
| Library availability | Yes | 图书馆开放时间调整、闭馆、区域暂停开放 | 资源荐购、数据库试用、借阅规则 | `missing_effective_window_or_status_signal` / `notice_level_query_owned` |
| Service counter / hospital / logistics window | Yes | 综合服务大厅暂停办理、校医院假期停诊、后勤窗口恢复服务 | 办理材料、申请入口、长期办事流程 | `missing_effective_window_or_status_signal` / `service_guide_owned` |
| Transport-adjacent status | Yes, only status facts | 班车停运、暂停运行、乘车点临时调整、接驳车恢复服务 | 班次、路线、首末班、服务日、时刻表 | `schedule_owned_fact` |
| Regulation candidate | No | None | 管理办法、细则、规定、章程、规则 | `regulation_owned` |
| Stable contact candidate | No | None | 电话、邮箱、联系人、办公地点 | `contact_directory_owned` |
| Notice-level query | No | None | 材料提交、名单公示、通知阅读、表格下载 | `notice_level_query_owned` |

## Fixed Rules

- Taxonomy route `service_status_candidate` is only a candidate signal; it is not runtime opening.
- Runtime query must read PostgreSQL current release and typed read model only.
- Materializer must produce either a valid typed record or a deterministic rejected-source row.
- Missing subject, missing effective window, unknown status, schedule-owned facts and service-guide-owned facts must fail closed.
- `unknown` is not a publishable current record status; it remains a runtime fail-close answer status only.
