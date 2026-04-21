---
workstream: execution-capability-family-convergence
created: 2026-04-21
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 5
**Current Phase Name:** One-Shot Full Rename Execution
**Current Plan:** `phases/phase-5-one-shot-full-rename-execution/PLAN.md`
**Total Phases:** 5
**Total Plans in Phase:** 1
**Progress:** 4/5 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** `Phase 4` 已完成 rename decision freeze；`Phase 5` planning pack 已创建，当前开始收口 one-shot full rename 的执行写集、顺序与验证矩阵。

## Current Slice

- 这条线是 repo-owned 长期 convergence workstream，不属于任何单一 domain lane。
- `Phase 1` 已正式 completed：
  - `phases/phase-1-agent-family-terminology-freeze/CONTEXT.md`
  - `phases/phase-1-agent-family-terminology-freeze/RESEARCH.md`
  - `phases/phase-1-agent-family-terminology-freeze/PLAN.md`
  - `phases/phase-1-agent-family-terminology-freeze/SUMMARY.md`
- `Phase 1` 已冻结的结论：
  - `supervisor` 保持 invariant role name
  - `rag-specialist -> rag-agent` 是首条 canonical convergence pair
  - `campus-services-agent` / `notice-agent` 继续作为 canonical forward family labels
  - `navigation-specialist -> navigation-agent` 的 coexistence 已写实
  - 早期实验性的 `availability-specialist` 已从 merged truth 退休；本线从 `Phase 3` 起不再把它当作固定前提
- `Phase 2` 已正式 completed：
  - `phases/phase-2-current-truth-contract-label-migration/CONTEXT.md`
  - `phases/phase-2-current-truth-contract-label-migration/RESEARCH.md`
  - `phases/phase-2-current-truth-contract-label-migration/PLAN.md`
  - `phases/phase-2-current-truth-contract-label-migration/SUMMARY.md`
- `Phase 2` 已冻结的实现真相：
  - `selected_target` / `selectedTarget` 继续只表示实际 runtime dispatch target
  - current serialized contract 不承载 forward family label
  - operator-facing display label 来自显式 mapping，而不是 raw target string
  - panel 当前 target filter 闭集已被显式收口
- `Phase 3` 已正式 completed：
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/CONTEXT.md`
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/RESEARCH.md`
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/PLAN.md`
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/SUMMARY.md`
  - prompt-facing wording 已不再把 `rag-specialist` 当默认 persona
  - eval 已显式拆分 runtime target assertion 与 capability family label
  - observability / operator wording 已固定 raw target 与 derived label 分层
- `Phase 4` 已正式 completed：
  - `phases/phase-4-package-and-runtime-rename-decision/CONTEXT.md`
  - `phases/phase-4-package-and-runtime-rename-decision/RESEARCH.md`
  - `phases/phase-4-package-and-runtime-rename-decision/PLAN.md`
  - `phases/phase-4-package-and-runtime-rename-decision/SUMMARY.md`
  - one-shot full rename 已被选定为固定方向
  - `selected_target` / `selectedTarget` 继续只表示 raw runtime target；后续若 rename raw target value，也只能在保持该语义不变的前提下执行
  - full rename 的 canonical write set 已冻结为 package dir / distribution / module import / raw runtime target / runtime helper / active docs / active planning / active tests
  - no-rename、partial rename、compatibility shim 已被正式拒绝
- 当前切片切到 `Phase 5`：
  - `phases/phase-5-one-shot-full-rename-execution/CONTEXT.md`
  - `phases/phase-5-one-shot-full-rename-execution/RESEARCH.md`
  - `phases/phase-5-one-shot-full-rename-execution/PLAN.md`
  - 当前开始 one-shot full rename 的执行规划与后续代码波次
  - 当前 focus 是单波次 cutover，不扩到新的 capability family，也不回头重做 `Phase 1-4` 的判断

## Blockers

- actual code rename 仍未开始；当前只完成了 Phase 5 的 execution planning truth。
- Python workspace metadata、raw runtime target enum/value、JS/TS operator-facing mappings 与 active docs/planning 需要在同一波次协同 cutover。
- `packages/rag-specialist/src/campus_rag_specialist/service.py` 仍是局部高耦合热点；执行时需要避免与其他并发改动冲突。
- 并发中的 availability 删除线不在这条 workstream 的 write set 内。

## Verification

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases.GoldenCaseSchemaTest tests.evals.test_golden_cases.RunCasesTest`
  - passed
  - 验证 runtime target / capability family split
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
  - passed
  - `225` tests
- `git diff --check -- docs/architecture/prompt-and-instruction-architecture.md docs/architecture/operator-observability-architecture.md docs/contracts/app-api-operator-observability-http.md`
  - passed
- `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/execution-capability-family-convergence/ROADMAP.md .planning/workstreams/execution-capability-family-convergence/STATE.md .planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md docs/plans/execution-capability-family-convergence.md .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/SUMMARY.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/CONTEXT.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/RESEARCH.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/PLAN.md`
  - passed
- `rg -n "one-shot full rename|Phase 5|compatibility shim|partial rename|rag-agent|navigation-agent" .planning/workstreams/execution-capability-family-convergence docs/plans/execution-capability-family-convergence.md .planning/WORKSTREAMS.md`
  - passed
  - 验证 `Phase 4 -> Phase 5` handoff、full rename admission 与拒绝 compatibility/partial rename 的 planning truth 已落盘

## Session Continuity

**Stopped At:** `Phase 5` planning pack created; next step is to按计划开始 code/doc/test one-shot full rename implementation
**Resume File:** `.planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/PLAN.md`
