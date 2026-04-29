---
doc_type: phase_plan
phase: "2"
phase_name: "Consumption Unit Schema"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Plan

## Objective

冻结 `derived consumption unit` 的最小正式 schema，让后续 work 不再重复争论“哪些字段属于上游 neutral unit、哪些字段只是 downstream alias、哪些字段现在必须占位而规则留到后面”，并为 `Phase 3` 和 `Phase 4` 提供稳定 handoff。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 冻结后的 source family / layering truth
- runtime tool 级 shared contract
- `scoped_rules` / `institutional_rules` 的一批 downstream metadata pattern

当前 repo 还没有：

- neutral `derived consumption unit` schema
- `primary_role` 与 `document_nature` 的上下游分工
- `semantic_owner` 与 `semantic_owner_kind` 的显式对齐
- `default_agent`、`target_surface`、`temporal_policy`、`completeness_status`、`answerability` 的统一 schema 位

如果不先做这一步，后续 phase 会持续漂移：

- derived unit 会不会和 runtime tool result 混成一层
- `document_nature` 会不会被误当成 root schema
- `completeness_status` / `answerability` 会不会继续停留在自然语言推断
- `default_agent` / `target_surface` 会不会被误写成 runtime 已 admission 事实

## Locked Inputs

- `source_notice -> notice_attachment -> derived consumption unit` 三层关系已冻结。
- `official_web_public_notice` 与 `internal_notice_restricted` 是当前唯一 admitted source family。
- 现有 runtime tool contract 已存在，不在本 phase 内重复设计。
- `Phase 2` 只冻结 schema，不实现 projection builder、tool adapter 或 query service。
- `Phase 3` 继续承接 authority / completeness 规则；本 phase 只负责字段与 value-space。

## Decisions To Freeze

1. derived consumption unit schema 固定属于 data-plane projection contract，而不是 `packages/contracts` 里的 runtime request/result seam。
2. schema 最小字段组固定为：
   - identity:
     - `unit_id`
     - `source_family`
   - provenance:
     - `source_notice_id`
     - `source_notice_release_time`
     - `source_attachment_ref_ids`
     - `source_notice_link`
     - `derived_from_raw_asset_id`
     - `derived_from_raw_version_id`
   - role / owner:
     - `primary_role`
     - `semantic_owner`
   - routing / target:
     - `default_agent`
     - `target_surface`
   - temporal / completeness:
     - `temporal_policy`
     - `completeness_status`
     - `answerability`
   - role-scoped metadata:
     - `role_metadata`
3. `primary_role` 固定为 upstream semantic role enum，至少覆盖：
   - `notice_window`
   - `annual_cycle_rule`
   - `time_bound_operational_rule`
   - `roster_publication`
   - `lecture_activity`
   - `service_status_override`
   - `attachment_rule_body`
   - `attachment_form_template`
4. `semantic_owner` 必须至少能表达：
   - `notice_body`
   - `attachment_document`
   - `wrapper_notice`
   - `authority_pending`
5. `default_agent` 固定是 forward-family routing hint，而不是 runtime opening truth；当前至少允许：
   - `notice-agent`
   - `rag-agent`
   - `campus-services-agent`
6. `target_surface` 固定是 repo-owned downstream target hint，而不是 opened-surface truth；当前至少允许：
   - `notice_runtime`
   - `regulations/scoped_rules`
   - `regulations/institutional_rules`
   - `service_status_runtime`
   - `publication_surface_candidate`
7. `temporal_policy` 固定独立于 runtime query mode，至少要能表达：
   - `announcement_window`
   - `explicit_year_only`
   - `time_windowed`
   - `current_override`
   - `point_in_time_publication`
   - `standing_until_replaced`
8. `completeness_status` 与 `answerability` 当前只冻结字段 presence 与 value-space 需要覆盖的状态，不冻结 derivation rule。
9. `document_nature`、`content_role`、`effective_date`、`cycle_year`、`school_unit_name`、`campus_site` 等字段默认属于 `role_metadata` 或 downstream alias，不应全部提升为 root schema。

## Execution Slices

### Slice 1: Freeze Schema Placement

- 明确 derived unit schema 属于 data-plane projection contract。
- 明确它位于 `source truth` 与 downstream projection / runtime consumption 之间。
- 明确它不替代现有 runtime tool schema。

### Slice 2: Freeze Identity And Provenance Fields

- 冻结 `unit_id` 与 provenance group。
- 尽量复用 repo 已稳定的 provenance 命名：
  - `source_notice_release_time`
  - `source_attachment_ref_ids`
  - `derived_from_raw_asset_id`
  - `derived_from_raw_version_id`
- 明确单条 unit 仍然 source-notice-backed，不反向改写 canonical upstream。

### Slice 3: Freeze Role And Owner Fields

- 冻结 `primary_role` 为 root semantic role。
- 冻结 `semantic_owner` 与现有 `semantic_owner_kind` 的关系。
- 明确 downstream `document_nature` / `content_role` 只是映射结果，不是 root field。

### Slice 4: Freeze Routing And Target Hints

- 冻结 `default_agent` 作为 default routing hint。
- 冻结 `target_surface` 作为 repo-owned adoption hint。
- 明确两者都不自动等于 surface opened truth。

### Slice 5: Freeze Temporal, Completeness, And Answerability Slots

- 冻结 `temporal_policy` value-space。
- 冻结 `completeness_status` 和 `answerability` 的字段存在性与状态覆盖范围。
- 明确 derivation / precedence / fail-close 规则后送 `Phase 3`。

### Slice 6: Freeze Downstream Mapping Rules

- 明确 `primary_role -> document_nature` 的 downstream mapping 关系。
- 明确 `semantic_owner -> semantic_owner_kind` 的 downstream mapping 关系。
- 明确 role-scoped metadata 如何按目标 surface 展开：
  - `annual_cycle_rule` -> `cycle_year` / `school_unit_name`
  - `time_bound_operational_rule` -> `effective_date` / `campus_site`
  - `service_status_override` -> service override metadata

### Slice 7: Prepare Phase 3 And Phase 4 Handoff

- 为 `Phase 3` 明确输入：
  - 现在有哪些 schema slots
  - 哪些 slot 还没有 derivation rule
- 为 `Phase 4` 明确输入：
  - `default_agent`
  - `target_surface`
  如何从 planning truth 进入 runtime / downstream adoption truth

## Proposed Write Set

- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/notice-consumption-layer.md`

## Verification Matrix

- phase artifact verification
  - `Phase 2` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- planning progression verification
  - `ROADMAP.md` 将 `Phase 1` 标记为已完成
  - `WORKSTREAMS.md` 的当前 phase 前移到 `Phase 2`
- schema verification
  - planning truth 明确区分 root schema 字段与 downstream alias
  - planning truth 明确 schema 属于 data plane，不属于 runtime tool contract
  - planning truth 明确 `default_agent` / `target_surface` 是 hint，而不是 opened-surface truth
- scope verification
  - planning truth 不打开 `fresh_news`
  - planning truth 不打开 restricted query-serving
  - planning truth 不重复设计 `packages/contracts` 里的 runtime tool payload/result

## Exit Rule

Phase 2 完成后，repo 应达到：

- `derived consumption unit` 的 root schema 已经冻结
- 后续 phase 不再重开“哪个字段属于 neutral unit”这类争论
- `Phase 3` 可以直接围绕 authority / completeness / answerability rule 推进
- `Phase 4` 可以直接围绕 default-agent / target-surface handoff 推进
