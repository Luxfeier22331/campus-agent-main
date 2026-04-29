---
doc_type: phase_plan
phase: "2"
phase_name: "Current-Truth Contract Label Migration"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Plan

## Objective

把 `Phase 1` 已冻结的 terminology mapping 转成 execution-facing contract truth，确保 current runtime target、forward family label 和 operator display label 不再混在同一个字段或同一批 schema example 里。

## Why This Phase Exists

当前 repo 已经完成术语冻结，但最容易出错的 surface 还没收口：

- shared contract 里的 `SpecialistTarget`
- `SupervisorResponse.selected_target`
- app-api execution / HTTP / operator docs 里的 `selected_target` / `selectedTarget`
- panel 的 target label 与 filter options

如果不做这一步，后续很容易出现三种腐烂：

- 把 `selected_target` 当成 runtime dispatch target 用，又拿它冒充 forward family label
- panel / operator surfaces 继续直接展示 raw string，或只 special-case 一小部分 target
- Phase 3 的 prompt / eval / observability rename 被迫连带承担 contract semantics 的清理工作

## Locked Inputs

- `Phase 1` 已冻结：
  - `supervisor` 保持 invariant name
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent` / `notice-agent` 是 canonical forward/current runtime labels
  - `availability-specialist` 暂无 `availability-agent`
- `campus-services-agent` 与 `notice-agent` 已是实际 delegate target，不是 docs-only alias。
- `rag-agent` 与 `navigation-agent` 当前仍不是 shared runtime contract target。
- 本 phase 不进行 package rename，不进行 prompt/eval/trace wording convergence。

## Decisions To Freeze

1. `SpecialistTarget` 在本 phase 明确定义为 current runtime dispatch target enum。
2. `selected_target` / `selectedTarget` 在本 phase 明确定义为实际被选中的 runtime target。
3. `rag-agent` 与 `navigation-agent` 不进入 shared runtime contract enum、HTTP example payload 或 response schema。
4. operator-facing display label 与 filter option 必须显式依赖 mapping table，而不是直接回显 raw target string。
5. current-truth docs / schema example 只展示 current runtime target；forward family label 只留在 target-side / planning docs。
6. 如果 future family grouping 确实需要进入 operator / observability / eval surface，必须使用显式新字段或 projection，不重载 `selected_target`。

## Execution Slices

### Slice 1: Audit Label Surfaces By Meaning

- 把受影响 surface 分成三类：
  - current runtime target field
  - operator display label
  - target-side family vocabulary
- 至少覆盖：
  - `packages/contracts`
  - `docs/contracts/app-api-supervisor-execution.md`
  - `docs/contracts/app-api-http.md`
  - `docs/contracts/app-api-operator-observability-http.md`
  - `docs/data/app-api-schema.md`
  - panel request / overview target label surfaces
  - contract / API / supervisor tests

### Slice 2: Freeze Current-Truth Contract Semantics

- 在 shared contract 和文档中把以下规则写实：
  - `SpecialistTarget` = current runtime target enum
  - `selected_target` = actual runtime target chosen by supervisor
- 明确禁止：
  - 把 `selected_target` 当成 family label
  - 在 current schema example 里写入 `rag-agent` / `navigation-agent`

### Slice 3: Freeze Operator-Facing Mapping

- 为 operator / panel surface 定义明确 mapping rule：
  - raw target value
  - localized display label
  - optional filter membership
- 完整覆盖当前 runtime target 闭集：
  - `rag-specialist`
  - `availability-specialist`
  - `navigation-specialist`
  - `campus-services-agent`
  - `notice-agent`
- 不允许继续只有 `rag-specialist` 特判、其余直接裸露 raw string。

### Slice 4: Freeze Contract-Test Boundary

- contract / API / supervisor tests 应继续断言 current runtime target values，而不是提早改成 forward family label。
- 同时把“哪些测试属于 current contract lane、哪些属于 prompt/eval/observability lane”写清，避免执行时一次性误改太多。

### Slice 5: Prepare The Phase 3 Handoff

- 明确 `Phase 3` 才处理：
  - telemetry / trace tag naming
  - eval wording / expectation wording
  - operator observability wording convergence
- `Phase 2` 只需为这些后续工作准备清晰 contract baseline，而不是顺手全部做完。

## Proposed Write Set

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/PLAN.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `docs/plans/execution-capability-family-convergence.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page/constants.ts`
- `apps/protected-panel-web/test/data-provider.test.ts`
- `tests/contracts/test_models.py`
- `tests/api/test_supervisor_api.py`
- `tests/supervisor/test_supervisor_core.py`
- `tests/supervisor/test_supervisor_policy.py`

## Verification Matrix

- planning truth
  - `Phase 2` 目录存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 2`
- contract truth
  - `SpecialistTarget` 被明确定义为 current runtime target enum
  - current schema docs / examples 不出现 `rag-agent` / `navigation-agent` 作为 serialized target
  - `selected_target` / `selectedTarget` 的语义被写清
- operator truth
  - panel display / filter surfaces 覆盖所有 current runtime target
  - operator-facing raw target 与 display label 不再混成同一概念
- phase boundary truth
  - telemetry / eval / prompt wording convergence 被显式 deferred 到 `Phase 3`
  - package dir / import path rename 被显式 deferred 到 `Phase 4`
- execution verification commands
  - `git diff --check -- .planning/workstreams/execution-capability-family-convergence docs/plans/execution-capability-family-convergence.md packages/contracts/src/campus_contracts/models.py packages/contracts/src/campus_contracts/__init__.py docs/contracts/app-api-supervisor-execution.md docs/contracts/app-api-http.md docs/contracts/app-api-operator-observability-http.md docs/data/app-api-schema.md apps/protected-panel-web/src/panel/requests/request-formatters.ts apps/protected-panel-web/src/panel/pages/overview-page/constants.ts tests/contracts/test_models.py tests/api/test_supervisor_api.py tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_policy.py`
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_policy`
  - `pnpm --dir apps/protected-panel-web test`

## Exit Rule

`Phase 2` 完成后，repo 应达到：

- current runtime target contract 不再与 forward family vocabulary 混义
- app-api / operator / panel 的 target label surface 已按 current-truth contract 收口
- `Phase 3` 可以只处理 prompt/eval/observability wording convergence，而不必再回头清理 schema / selected_target semantics
