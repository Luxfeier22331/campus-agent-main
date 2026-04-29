---
doc_type: phase_plan
phase: "2"
phase_name: "Tool Contract Freeze"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Plan

## Objective

冻结首发 `4` 个 tool 的 shared payload/result schema、tool outcome enum、temporal semantics、historical downgrade 与 fail-close output shape，让后续 `Phase 3-4` 可以直接围绕 source/projection truth 和 runtime wiring 实施，而不是继续争论 contract 该长成什么。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 冻结后的 capability boundary、tool closed set、notice source matrix 与 temporal semantics owner
- `packages/contracts` 作为 supervisor / specialist shared seam
- `SupervisorRequest` / `SpecialistRequest` / `SpecialistResponse` 的现有 typed contract pattern

当前 repo 还没有：

- `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get` 的 shared dataclass
- tool outcome enum 与 fail-close / historical downgrade reason taxonomy
- shared temporal request vocabulary
- `discover` 与 `get` 分离的 notice result shape

如果不先做这一步，后续 implementation 会在以下问题上持续漂移：

- contract 到底该按 tool 写，还是按 `*-specialist` / `*-agent` label 写
- `current/latest/effective` 是不是继续埋在自然语言里
- “当前不可证”“只找到往年通知”“命中当前 notice 正文”该落在哪一层状态枚举
- `campus_notice_get` 到底返回正文，还是只返回链接

## Locked Inputs

- `Phase 1` 已 completed；首发 tool set 固定为：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- `transport_notice_latest`、`transport_pickup_point_lookup` 继续 deferred。
- `contact_directory_lookup`、`service_process_lookup` 继续留在 `Phase 6-7`。
- `service_catalog`、`internal_notice`、`fresh_news` 继续不是 query-enabled surface。
- current-truth `*-specialist` label 与 forward `*-agent` label 允许短期并存，但本 phase 不做 repo-wide rename。
- `Phase 2` 只冻结 contract，不冻结 source projection / query service / runtime wiring。

## Decisions To Freeze

1. contract identity 固定锚定在 tool name，而不是 family label。
2. 这四个 tool 各自必须拥有 dedicated payload/result dataclass，并通过 `packages/contracts` 导出。
3. shared temporal request vocabulary 至少要显式承接：
   - `current`
   - `latest`
   - `effective`
   - `as_of`
   - `current_year`
4. tool business outcome enum 必须与 `DelegateStatus` / `SupervisorStatus` 分离，并能表达至少以下语义：
   - current hit
   - historical reference only
   - not found
   - temporarily unverifiable / fail-closed
   - clarification required
5. `service_status_lookup` result 至少要冻结：
   - resolved subject / target summary
   - observed or effective status
   - effective time window / queried time anchor
   - override / provenance refs
   - fail-close reason
6. `transport_schedule_lookup` result 至少要冻结：
   - resolved route / service summary
   - service window / queried time anchor
   - stop refs / service point refs
   - related notice refs
   - fail-close reason
7. `campus_notice_discover` result 至少要冻结：
   - notice card list
   - source family
   - `published_at` / `effective_at`-style metadata
   - current-year miss / historical downgrade reason
   - whether result set is current or historical-only
8. `campus_notice_get` result 至少要冻结：
   - canonical notice id / title
   - normalized body
   - source family
   - source URL / canonical URL
   - published/effective metadata
   - related attachment / provenance placeholder fields
9. fail-close 与 historical downgrade 必须是 result-observable field，不允许只放在 `answer_text`。
10. `Phase 2` 的 contract 冻结不能反向打开 query-enabled surface，也不能把 query service 细节泄漏进 shared schema。

## Execution Slices

### Slice 1: Freeze Contract Placement And Naming

- 明确 contract owner 在 `packages/contracts`
- 明确 schema 命名按 tool identity，而不是按当前/前向 family label 命名
- 明确 future `SpecialistTarget` / payload union 扩张只能消费这些冻结后的 tool-local schema，而不是边实现边发明第二套 shape

### Slice 2: Freeze Shared Temporal And Outcome Vocabulary

- 冻结所有首发 tool 共用的 temporal request vocabulary
- 冻结 shared outcome taxonomy 与 fail-close / downgrade reason vocabulary
- 明确哪些字段是 shared helper，哪些必须留在 tool-local result 中

### Slice 3: Freeze Campus Services Tool Contracts

- 为 `service_status_lookup` 冻结 payload/result shape
- 为 `transport_schedule_lookup` 冻结 payload/result shape
- 明确二者都不能把“当前状态不可证”退化成自由文本补丁
- 明确 `navigation-agent` 只消费 point refs，不因此获得 timetable/service-status owner

### Slice 4: Freeze Notice Tool Contracts

- 为 `campus_notice_discover` 冻结 discovery-card result shape
- 为 `campus_notice_get` 冻结 canonical-body result shape
- 明确 current-year miss / historical-only result 的结构化表达
- 明确 public notice-like pages 与 restricted internal notices 只是 `source_family` 输入，不在本 phase 打开 retrieval surface

### Slice 5: Freeze Shared Seam Integration

- 明确这些 tool-local schema 与：
  - `SpecialistRequest.payload`
  - `SpecialistResponse.result`
  - `SupervisorResponse.result`
  的未来集成方式
- 明确 business outcome enum 与 terminal status enum 的分层关系
- 明确 `packages/contracts/__init__.py` 的 export 扩张口径

### Slice 6: Prepare Phase 3 And Verification Gate

- 为 `Phase 3` 明确 contract-side prerequisite：
  - 每个 tool 的 payload/result 已冻结
  - temporal vocabulary 已冻结
  - historical downgrade / fail-close 已有结构化表达
- 为后续实现冻结最小验证入口：
  - contract dataclass validation tests
  - routing / framing regression tests
  - outcome enum edge-case fixtures

## Proposed Write Set

- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/RESEARCH.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/PLAN.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `tests/contracts/`
- `tests/supervisor/`

## Verification Matrix

- planning verification
  - `Phase 2` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- contract verification
  - planning truth 明确四个 tool 各自拥有 dedicated payload/result dataclass
  - planning truth 明确 shared temporal vocabulary 与 tool outcome enum
  - planning truth 明确 `discover` / `get` 分离
- boundary verification
  - planning truth 不把 `service_catalog`、`internal_notice`、`fresh_news` 写成 query-enabled scope
  - planning truth 不把 query service / projection table 细节泄漏进 shared schema
  - planning truth 不让 `navigation-agent` 重新拥有 transport/service truth
- regression verification
  - `tests/supervisor/test_supervisor_routing.py`
  - `tests/supervisor/test_supervisor_query_policy.py`
  - future `packages/contracts` dataclass validation tests 应覆盖：
    - current hit
    - historical reference only
    - temporarily unverifiable
    - invalid temporal combination

## Exit Rule

Phase 2 完成后，repo 应达到：

- 后续执行者不再需要重开“tool contract 应该按什么字段表达”这类讨论
- `Phase 3` 可以直接围绕 source-truth / normalized-truth owner 与 projection shape 推进
- `Phase 4` 可以直接围绕 `SpecialistRequest` / `SpecialistResponse` 扩张、tool adapter 与 supervisor handoff 实施
- future label migration 即使发生，也不会反向打碎这四个 tool 的 schema truth
