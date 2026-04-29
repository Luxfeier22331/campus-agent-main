---
doc_type: requirements
status: active
created: 2026-04-20
updated: 2026-04-21
---

# Requirements: Campus Services Notices Runtime Admission

## Goal

为 `campus_services` / `campus_notice` 场景建立独立于 generic RAG 的 runtime admission lane，冻结 domain-agent 边界、首发 tool surface、strict contract 与 fail-close 口径，使后续实现能在不重开边界讨论的前提下推进。

## In Scope

- `supervisor`、`campus-services-agent`、`notice-agent`、`navigation-agent`、`rag-agent` 的 runtime boundary
- 首发 `4` 个 tool 的 planning admission：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- transport / notice 用户问句的 routing 与 terminal semantics
- 服务开放状态 / 临时关闭 / 营业时间问句的 routing 与 terminal semantics
- `current/latest/effective` 时间语义、historical downgrade 与 fail-close 规则
- repo-owned internal query service / projection query seam 与 thin tool adapter 边界
- transport / notice tool 的 source-truth / normalized-truth ownership freeze
- 后续 runtime wiring、eval / observability 与 opening gate 规划
- later-wave bounded tool admission:
  - `contact_directory_lookup`
  - `service_process_lookup`

## Non-goals

- reopen `campus-services-offline-preparation-hardening`
- 把讲座通知、公示、结果公示、时刻表直接并入默认 generic RAG 消费面
- `official_web/fresh_news` / `official_web/news_archive` opening
- route planning / map UI / location permission implementation
- auth-dependent authenticated-notice capture、`file_release` export / owner recovery
- general web fallback、flat tool router 或新的 supervisor mega-tool shell

## Success Criteria

1. repo planning truth 中存在独立 workstream，明确区分 runtime admission 与既有 `offline_preparation`。
2. 首发 tool surface 固定收口为 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get`，而不是继续扩成高重叠 tool 集。
3. `current/latest/effective` 语义、历史参考降级与 fail-close 行为被写成显式 contract，而不是留给 prompt 自猜。
4. `campus-services-agent` / `notice-agent` 与 `navigation-agent` 的 ownership 明确，`rag-agent` 不重新吸收 transport / notice 问答；但公费医疗报销规则、办理流程、材料清单这类稳定制度/流程问题在当前阶段继续由 `rag-agent` 承接。
5. 后续实现采用 projection-backed internal query service + thin tool adapter，而不是 query-time raw source scan 或 `app-api` loopback HTTP。
6. 后续实现会话可以直接从 `Phase 1-2` 开始，不再重新争论这条 runtime lane 是否属于旧 `campus_services` offline-preparation workstream。
7. 联系方式 / 部门电话问题被明确排除出 generic RAG 消费面，并被写成 `contact_directory_lookup` 的显式后续 admission phase，而不是继续悬空。
8. `service_process_lookup` 是否需要承接稳定校园服务流程问题被写成独立 follow-up phase；在该 phase 完成前，当前 merged truth 继续由 `rag-agent` 承接这类问题。

## Canonical Entry

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
