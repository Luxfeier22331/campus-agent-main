---
phase: "2"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Research

## Purpose

把 `Phase 2: Consumption Unit Schema` 建立在三类既有真相之上：

- `Phase 1` 已冻结的 source family / layering boundary
- repo 已落地的 runtime tool schema
- repo 已落地的 scoped-rule / regulation downstream metadata

## Repo Pattern Readings

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`

## Findings

### 1. Derived consumption unit schema 不是 runtime tool contract

- `packages/contracts` 已经有 `CampusNoticeDiscover/Get`、`ServiceStatusLookup`、`TransportScheduleLookup` 这类 runtime seam。
- `notice consumption layer` 要冻结的是更早一层的 data-plane projection contract。
- 所以 `Phase 2` 的正确动作不是重复设计 runtime payload/result，而是定义这些 runtime 之后所消费的 typed unit。

### 2. Repo 已有 downstream metadata，可作为上游 schema 的命名约束

- `internal_notice_scoped_rule_materialization` 已经稳定产出：
  - `document_nature`
  - `effective_date`
  - `source_notice_release_time`
  - `source_attachment_ref_id`
  - `cycle_year`
  - `school_unit_name`
  - `campus_site`
- `internal_notice_regulation_materialization` / projection 已经稳定产出：
  - `semantic_owner_kind`
  - `source_attachment_ref_id`
  - `source_notice_release_time`
  - `effective_date`
- 这说明 `Phase 2` 不该另起一套完全不同的命名，而应尽量让 upstream schema 能自然下投到这些已存在字段。

### 3. `primary_role` 应是上游角色字段，`document_nature` 是下游别名

- 当前 `annual_cycle_rule`、`time_bound_operational_rule` 等 role 已经在 planning truth 中存在。
- scoped-rules materialization 使用 `document_nature`，但它是面向 holding collection 的 downstream field。
- 因此更稳的做法是：
  - upstream 用 `primary_role`
  - downstream 再映射到 `document_nature` / `content_role`

### 4. `semantic_owner` 应与现有 `semantic_owner_kind` 对齐

- regulation promotion / projection 已经证明 `semantic_owner_kind` 是稳定有用的概念。
- `Phase 2` 应直接利用这层语义，而不是重新发明一个完全独立的 owner 字段。
- 但 consumption layer 还需要表达 `authority_pending` 这类 pre-Phase-3 状态，因此上游 schema 应稍宽于当前已实现的 downstream kind。

### 5. Temporal metadata 必须按 role 区分，不应一股脑抬成顶层

- `annual_cycle_rule` 真正依赖：
  - `cycle_year`
  - `school_unit_name`
  - `admission_route` 一类字段
- `time_bound_operational_rule` 真正依赖：
  - `effective_from/effective_to`
  - `campus_site`
  - `operational_domain`
- `lecture_activity` / `roster_publication` / `notice_window` 更像 point-in-time or windowed publication。
- 这支持把 role-specific metadata 放进 `role_metadata`，而不是把所有字段抬成 schema 顶层。

### 6. `default_agent` 与 `target_surface` 必须保持“hint”语义

- target architecture 已经冻结：
  - `notice-agent`
  - `rag-agent`
  - `campus-services-agent`
  是 forward family labels
- 但这些 label 不自动等于 runtime opening，也不自动等于 semantic owner。
- 同理，`regulations/scoped_rules` / `regulations/institutional_rules` 是 target collection / surface hints，不应被写成已开放事实。

### 7. `completeness_status` 与 `answerability` 必须先入 schema，再在 Phase 3 定义规则

- workstream requirement 已经要求这两个字段最终存在。
- Phase 1 也已明确 authority/completeness 不能被跳过。
- 因此 `Phase 2` 最合理的 freeze 是：
  - 字段现在就必须存在
  - value-space 现在就必须被保留
  - 具体 derivation 与 precedence 规则后送 `Phase 3`

## Phase-2 Decisions To Freeze

1. derived consumption unit schema 位于 data plane，不位于 runtime tool contract。
2. `primary_role` 是 upstream role field；`document_nature` / `content_role` 是 downstream projection alias。
3. `semantic_owner` 必须向现有 `semantic_owner_kind` 靠拢。
4. `default_agent` / `target_surface` 是 routing / adoption hint，不是 opened-surface truth。
5. role-specific temporal metadata 应进入 `role_metadata`，而不是默认成为顶层字段。
6. `completeness_status` / `answerability` 先占 schema 位，再把 derivation 留给 `Phase 3`。

## Deferrals

- `Phase 3`
  - authority / precedence
  - attachment-missing semantics
  - `completeness_status` / `answerability` derivation
- `Phase 4`
  - default_agent -> runtime lane handoff
  - target_surface -> actual adoption lane
- `Phase 5`
  - worked example
  - verification closeout

## Risks If Mis-Scoped

- 如果把 derived unit schema 写进 runtime tool contract，后续会与现有 `packages/contracts` tool seam 发生重复建模。
- 如果把 `document_nature` 直接当 upstream root field，schema 会被某个 downstream collection 反向绑死。
- 如果把 role-specific metadata 全部抬成顶层字段，schema 会快速膨胀成混合对象。
- 如果 `default_agent` / `target_surface` 被写成 admission 事实，planning 会错误地提前打开 surface。

## Conclusions For Phase 2

1. 这一步应冻结“上游 neutral schema”，不是重复 runtime contract。
2. schema 必须能向现有 scoped-rule / regulation metadata 自然投影。
3. `primary_role`、`semantic_owner`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status`、`answerability` 是这一步的核心字段。
4. Phase 3 应直接围绕 authority / completeness 规则推进，而不再重开字段设计。
