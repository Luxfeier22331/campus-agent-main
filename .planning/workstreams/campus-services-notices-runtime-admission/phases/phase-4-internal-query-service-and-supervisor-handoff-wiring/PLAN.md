---
doc_type: phase_plan
phase: "4"
phase_name: "Internal Query Service And Supervisor Handoff Wiring"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 4 Plan

## Objective

冻结首发 `4` 个 tool 的 internal query service、thin tool adapter、supervisor handoff、per-agent `allowed_tools` 与 execution ownership，让后续实现不再重开“谁调谁、谁拥有查询、谁拥有工具”的问题。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` capability boundary
- `Phase 2` shared contract
- `Phase 3` projection truth owner
- 稳定的 `app-api -> supervisor-api -> supervisor-core -> specialist` execution seam

当前 repo 还没有：

- internal query service interface truth
- domain-owned tool adapter layer
- `campus-services-agent` / `notice-agent` 的 handoff wiring truth
- per-agent `allowed_tools` enforcement

如果不先做这一步，后续 implementation 会在以下问题上持续漂移：

- `app-api` 要不要直接查 projection
- `supervisor-core` 要不要直接查 structured truth
- 新 tool 是不是继续塞回旧 specialist
- `allowed_tools` 是不是只靠 prompt 提醒

## Locked Inputs

- 首发 tool set 不变：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- `Phase 2` contract 不再重开。
- `Phase 3` projection truth owner 不再重开。
- 本 phase 不实现 opening gate，不打开 query-serving surface。

## Decisions To Freeze

1. `app-api` 继续只做产品层 request projection 与 internal execution caller；不直接调用 internal query service。
2. `supervisor-api` / `supervisor-core` 继续只做 execution admission、routing、handoff shaping、response finalization。
3. internal query service 必须是 execution-side repo-owned seam，不得走 browser/public API 或 `app-api` loopback HTTP。
4. tool adapter 必须保持 thin：
   - payload in
   - query service call
   - typed result out
   - no raw/source scan
5. per-agent `allowed_tools` 必须 code-owned：
   - `campus-services-agent`: `service_status_lookup` + `transport_schedule_lookup`
   - `notice-agent`: `campus_notice_discover` + `campus_notice_get`
   - `navigation-agent`: 不获得 timetable/service-status truth
6. current-truth label coexistence 继续允许，但 wiring 不得因此继续堆在旧 specialist 里失真。
7. `SupervisorResponse.result` 继续是唯一上游返回 seam；`app-api` 不得把 raw tool-adapter internals 直接暴露成 browser contract。

## Execution Slices

### Slice 1: Freeze Execution Ownership

- 明确 `app-api`、`supervisor-api`、`supervisor-core`、domain-agent、internal query service 各自 owner
- 明确不允许的 shortcut path

### Slice 2: Freeze Internal Query Service Interface

- 冻结 query service 的输入/输出层级
- 明确它只读 `Phase 3` 已冻结的 projection truth
- 明确 failure / no-result / fail-close 的传播方式

### Slice 3: Freeze Tool Adapter Layer

- 冻结 adapter owner 和职责
- 明确 adapter 只做 payload/result 映射
- 明确 adapter 不重新拥有 truth owner

### Slice 4: Freeze Supervisor Handoff

- 冻结 `supervisor -> campus-services-agent / notice-agent` 的 wiring direction
- 冻结 current-truth delegate map 如何过渡到新 family
- 冻结 per-agent `allowed_tools` enforcement seam

### Slice 5: Freeze App API / Supervisor API Seam Impact

- 明确 product-layer execution contract 需要保持稳定的字段
- 明确哪些变更只发生在 execution-side internal seam
- 明确 browser 不感知 tool/query service internals

### Slice 6: Prepare Phase 5 Admission

- 明确 `Phase 5` 的验证前提：
  - handoff 路径已冻结
  - `allowed_tools` 已冻结
  - query service / adapter seam 已冻结
  - opening gate 还未打开

## Proposed Write Set

- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/SUMMARY.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/RESEARCH.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/PLAN.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`

## Verification Matrix

- planning verification
  - `Phase 3` 存在 `SUMMARY.md`
  - `Phase 4` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 4`
- contract verification
  - `packages/contracts/src/campus_contracts/models.py` 继续保留四个首发 tool contract
- boundary verification
  - planning truth 明确 `app-api` 不拥有 query service / tool adapter
  - planning truth 明确 `supervisor-core` 不直接拥有 structured truth query
  - planning truth 明确 per-agent `allowed_tools`
- regression verification
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.supervisor.test_supervisor_core tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist`

## Exit Rule

Phase 4 完成后，repo 应达到：

- 后续执行者不再需要重开 handoff / adapter / query service owner 讨论
- `Phase 5` 可以直接围绕 verification、observability 与 opening gate 推进
