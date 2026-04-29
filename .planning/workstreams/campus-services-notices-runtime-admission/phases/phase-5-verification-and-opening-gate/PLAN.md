---
doc_type: phase_plan
phase: "5"
phase_name: "Verification And Opening Gate"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Plan

## Objective

冻结首发 `4` 个 tool 的 verification / observability / opening gate truth，让后续执行者明确知道：

- 什么时候 gate 仍必须 closed
- 需要哪些 eval / runtime evidence 才能进入 opening 讨论
- opening 后 operator 至少要看见哪些 typed summary

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` capability boundary
- `Phase 2` shared contract
- `Phase 3` structured truth owner
- `Phase 4` internal query service protocol、thin adapter、supervisor handoff 与 `allowed_tools` wiring

当前 repo 还没有：

- opening 前的 verification matrix
- runtime capability 的 minimal observability summary truth
- “哪些条件满足才允许打开 service / notice lane” 的正式 gate checklist

如果不先做这一步，后续 execution 容易在以下问题上漂移：

- stub path / unavailable path 被误写成“能力已上线”
- historical downgrade 被当成 current answer
- stable制度/流程问题被错误吸进 structured runtime
- operator 只能看到模糊 `no_answer`，看不到 fail-close / downgrade / source-family summary

## Locked Inputs

- 首发 tool set 不变：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- `Phase 4` owner / protocol / adapter / handoff truth 不再重开。
- 本 phase 不把 backing query implementation 缺口伪装成可 opening 的 runtime。

## Decisions To Freeze

1. opening gate 默认保持 closed，直到 backing query implementation、eval evidence 与 observability summary 三类前置条件同时满足。
2. verification matrix 至少覆盖：
   - `service_status_lookup` current-state-unverifiable fail-close
   - `transport_schedule_lookup` current-state-unverifiable fail-close
   - `campus_notice_discover` current-year miss -> explicit historical reference
   - stable制度/流程问题继续由 `rag-specialist` 承接，而不是误入 structured runtime
3. operator-facing typed summary 至少显式区分：
   - selected target
   - tool business outcome
   - fail-close reason
   - historical downgrade reason
   - notice source family
4. `app-api -> supervisor-api` execution contract 继续保持稳定；新增 gate evidence 只应进入 execution-side observability / eval truth，不得扩成 browser contract。
5. 未满足前置条件时，只允许：
   - keep gate closed
   - surface deterministic unavailable/fail-close truth
   不允许写成“已支持但数据暂时不足”这类模糊半开状态。

## Execution Slices

### Slice 1: Freeze Verification Matrix

- 为首发 `4` 个 tool 列出必须通过的 deterministic / regression / eval lane
- 明确哪些属于 runtime smoke，哪些属于 release gate

### Slice 2: Freeze Observability Summary

- 明确 execution-side 必须返回给 app-owned read model 的最小 summary 字段
- 明确哪些字段不允许进入 panel/browser

### Slice 3: Freeze Opening Gate Checklist

- 明确 gate open 的前置条件
- 明确 gate closed 的 blocking conditions

### Slice 4: Freeze Stable-RAG Boundary Verification

- 明确公费医疗报销规则、材料、办理流程等稳定问题继续由 `rag-specialist` 承接
- 明确 structured runtime 不抢这类问题

### Slice 5: Prepare Phase 6 Admission

- 确保 `contact_directory_lookup` 的 later-wave admission 不会反向污染 Phase 5 opening truth

## Proposed Write Set

- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/SUMMARY.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/RESEARCH.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/PLAN.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/WORKSTREAMS.md`

## Verification Matrix

- planning verification
  - `Phase 4` 存在 `SUMMARY.md`
  - `Phase 5` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 5`
- phase-close verification
  - `packages/campus-services-agent` 与 `packages/notice-agent` 存在并可被 workspace 发现
  - `packages/supervisor-core` 默认 delegate map 已接上两个 forward runtime agent
- regression verification
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist tests.specialist.test_campus_services_agent tests.specialist.test_notice_agent tests.test_workspace_layout`
  - `uv run --all-packages python -m unittest tests.api.test_supervisor_api`

## Exit Rule

Phase 5 完成后，repo 应达到：

- opening gate 的 evidence contract 已冻结
- operator-facing minimal observability summary 已冻结
- 后续执行者可以直接围绕 backing query implementation + gate evidence 推进，而不再重开“什么算 ready to open”讨论
