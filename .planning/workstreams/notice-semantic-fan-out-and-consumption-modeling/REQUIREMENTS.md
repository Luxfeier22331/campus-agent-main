---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Requirements: Notice Semantic Fan-out And Consumption Modeling

## Goal

为 notice 场景建立独立于 runtime tool admission 与 downstream regulation hardening 的 semantic-modeling lane，
冻结 `source_notice / notice_attachment / derived consumption unit` 的关系、单元 schema、authority /
completeness contract 与后续 agent handoff，使 notice 不再被当作单一消费对象处理。

## In Scope

- `source_notice`、`notice_attachment`、`derived consumption unit` 的概念边界
- `source_notice + attachment -> derived consumption units` 的 fan-out contract
- role taxonomy：
  - `notice_window`
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  - `roster_publication`
  - `lecture_activity`
  - `service_status_override`
  - `attachment_rule_body`
  - `attachment_form_template`
- derived unit 核心字段：
  - `primary_role`
  - `semantic_owner`
  - `default_agent`
  - `target_surface`
  - `temporal_policy`
  - `completeness_status`
  - `answerability`
- notice body / attachment body / wrapper text 的 authority 关系
- `attachments_declared`、`attachments_captured`、`authoritative_attachment_missing` 等 completeness 语义
- public notice 与 restricted internal notice 是否共用同一 semantic fan-out contract
- future handoff 给 `notice-agent`、`rag-agent`、`campus-services-agent` 的规则

## Non-goals

- 直接实现新的 runtime tool、query service 或 UI
- reopen `regulations/scoped_rules` 或其他 query-serving surface
- `official_web` news opening
- auth-dependent notice capture、`file_release` owner recovery
- OCR、chunking、release promotion、retrieval ranking 细节

## Success Criteria

1. repo planning truth 中存在独立 workstream，明确把 notice semantic modeling 从 runtime admission 中拆出。
2. 单条 notice 的多角色消费被建模成 `source_notice -> multiple derived consumption units`，而不是一个混合 notice 对象直接服务所有 agent。
3. `primary_role`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status` 成为正式字段，而不是靠标题关键词和人工判断。
4. 正文与附件的 authority / precedence 被写成显式 contract；附件缺失时的 answerability / fail-close 规则被正式落盘。
5. 至少有一条 worked example 能证明：同一条 notice 可以同时产生 `notice_window` 与 `annual_cycle_rule` 候选，但两者不会在消费面混淆。
6. 后续 runtime / rule lane 会话可直接基于这份 modeling truth 推进，而不必重新争论“整条通知是否进入 RAG”。

## Canonical Entry

- `docs/plans/notice-semantic-fan-out-and-consumption-modeling.md`
