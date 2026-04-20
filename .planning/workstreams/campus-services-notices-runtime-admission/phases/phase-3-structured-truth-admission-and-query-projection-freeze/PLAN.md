---
doc_type: phase_plan
phase: "3"
phase_name: "Structured Truth Admission And Query Projection Freeze"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Plan

## Objective

冻结首发 `4` 个 tool 各自消费的 source-truth / normalized-truth lane、query projection shape 与 required metadata，让后续 `Phase 4` 可以直接实现 projection-backed internal query service 和 thin tool adapter，而不是继续争论“应该从哪层读真相”。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 冻结后的 capability boundary 与 notice source matrix
- `Phase 2` 冻结后的 tool-local payload/result schema
- `service_catalog`、`official_web`、`internal_notice` 各自已有不同层级的 source/projection pattern

当前 repo 还没有：

- `service_status_lookup` / `transport_schedule_lookup` 各自的 projection truth owner
- `campus_notice_discover/get` 的 public/restricted source-family projection split
- future internal query service 应读哪些 projected truth、必须过滤哪些 raw/retrieval path 的正式 contract

如果不先做这一步，后续 implementation 会在以下问题上持续漂移：

- `service_catalog` 能不能直接当 query seam
- `fresh_news` opening 和 public notice runtime 是不是同一件事
- `internal_notice` 是不是可以直接被当成 generic retrieval surface
- `navigation-agent` 到底只是消费 point refs，还是要重新拥有 transport truth

## Locked Inputs

- 首发 tool set 不变：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- `Phase 2` 合同字段已冻结，不再重开 payload/result shape。
- `service_catalog`、`internal_notice`、`fresh_news` 继续不是 query-enabled surface。
- `official_web` public notice family 与 `internal_notice` restricted notice family 继续显式分离。
- 本 phase 不实现 query service / tool adapter / supervisor wiring。

## Decisions To Freeze

1. `service_status_lookup` 的 truth owner 必须是 current-effective status projection，而不是 `service_catalog` 文本检索或 raw source scan。
2. `transport_schedule_lookup` 的 truth owner 必须是 route/window/stop projection，而不是 `navigation-agent` 反向拥有 timetable truth。
3. `campus_notice_discover` 必须消费 source-family-aware notice discovery projection：
   - public `official_web` notice-like projection
   - restricted `internal_notice` notice projection
4. `campus_notice_get` 必须消费 canonical notice body projection，不直接拼 raw source bundle。
5. 这些 query projection 至少要覆盖 `Phase 2` schema 已冻结的 required metadata：
   - source family
   - source URL / canonical URL
   - published/effective time
   - current/effective time anchors
   - related notice refs / stop refs / override refs
   - fail-close / historical downgrade reason
6. future internal query service 必须只读 projected truth；不得：
   - 直接打 retrieval alias
   - 扫 raw/source-truth artifacts
   - 通过 browser-facing API 或 `app-api` loopback HTTP 取数
7. `official_web/fresh_news` opening 与 notice runtime 继续解耦：
   - opening 是 `Phase 5` 之后的 retrieval/runtime gate 问题
   - 本 phase 只冻结 notice runtime 所需 public notice projection contract

## Execution Slices

### Slice 1: Freeze Service Status Projection Owner

- 明确 `service_status_lookup` 只读的 projection family
- 冻结 subject identity、operational status、effective window、override refs 的 required fields
- 明确它与 handbook-derived `service_catalog` canonical text 的关系：
  - 后者可作为 upstream materialization来源
  - 但不是 runtime query seam 本身

### Slice 2: Freeze Transport Schedule Projection Owner

- 明确 `transport_schedule_lookup` 只读的 projection family
- 冻结 route identity、service window、stop refs、related notice refs 的 required fields
- 明确 `navigation-agent` 只消费 stop refs，不拥有 timetable projection owner

### Slice 3: Freeze Public Notice Projection

- 明确 public notice family 来自 `official_web` notice-like pages，而不是 generic `fresh_news` retrieval opening
- 冻结 discover/get 需要的 projected fields：
  - title
  - summary
  - canonical body
  - source URL
  - published/effective metadata
  - article/detail evidence requirements

### Slice 4: Freeze Restricted Notice Projection

- 明确 restricted notice family 来自 `campus_notices/internal_notice`
- 冻结 discover/get 需要的 projected fields与 authorization-sensitive metadata
- 明确它继续只是 restricted notice source family，不改写 collection posture

### Slice 5: Freeze Query Projection Filter And Seam

- 明确 future internal query service 允许读取的 projection / normalized truth
- 明确必须拒绝的读取路径：
  - query-disabled retrieval alias
  - raw/source-truth bundle
  - browser/public API
  - `app-api` loopback HTTP
- 明确 projection query 返回 shape 如何对齐 `Phase 2` contract

### Slice 6: Prepare Phase 4 Admission

- 为 `Phase 4` 明确 implementation prerequisite：
  - 每个 tool 的 truth owner 已冻结
  - query projection shape 已冻结
  - public/restricted notice source-family split 已冻结
- 为后续实现预留验证入口：
  - projection contract tests
  - query filter rejection tests
  - public/restricted notice provenance tests

## Proposed Write Set

- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/SUMMARY.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/RESEARCH.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/PLAN.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`

## Verification Matrix

- execution verification
  - `packages/contracts/src/campus_contracts/models.py` 存在四个 tool 的 dedicated payload/result contract
  - `packages/contracts/src/campus_contracts/__init__.py` 已导出这些 contract
- regression verification
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.supervisor.test_supervisor_core tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist`
- planning verification
  - `Phase 2` 存在 `SUMMARY.md`
  - `Phase 3` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 3`
- boundary verification
  - planning truth 不把 `service_catalog`、`internal_notice`、`fresh_news` 写成 query-enabled scope
  - planning truth 明确 public/restricted notice projection 继续分离
  - planning truth 明确 query seam 只读 projected truth

## Exit Rule

Phase 3 完成后，repo 应达到：

- 后续执行者不再需要重开“tool 应该从哪一层读真相”这类讨论
- `Phase 4` 可以直接实现 internal query service、tool adapter 与 supervisor handoff
- `Phase 5` 可以直接围绕 opening gate、eval 与 observability 设计验证
