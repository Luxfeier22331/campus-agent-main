---
doc_type: phase_plan
phase: "5"
phase_name: "One-Shot Full Rename Execution"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Plan

## Objective

执行 `rag-specialist` / `navigation-specialist` 到 `*-agent` 的 one-shot full rename，并在不改变 `selected_target` / `selectedTarget` 字段语义的前提下，把 active code/doc/test/planning truth 一次性切到新的 runtime identity。

## Why This Phase Exists

`Phase 1-4` 已经完成：

- family terminology freeze
- current-truth contract label split
- prompt / eval / observability wording convergence
- full rename decision freeze

因此当前唯一剩余问题不是“是否 rename”，而是“如何执行 rename，且不留下双命名残留”。

## Locked Inputs

- one-shot full rename 已被 admission
- `selected_target` / `selectedTarget` 继续表示 raw runtime target
- 不允许 compatibility shim、dual naming alias、temporary wrapper
- `campus-services-agent` / `notice-agent` 不进入本 phase rename scope
- availability 删除线不属于本 phase

## Rename Rules To Enforce

1. package dir
   - `packages/rag-specialist -> packages/rag-agent`
   - `packages/navigation-specialist -> packages/navigation-agent`
2. distribution name
   - `campus-rag-specialist -> campus-rag-agent`
   - `campus-navigation-specialist -> campus-navigation-agent`
3. module import root
   - `campus_rag_specialist -> campus_rag_agent`
   - `campus_navigation_specialist -> campus_navigation_agent`
4. raw runtime target value
   - `rag-specialist -> rag-agent`
   - `navigation-specialist -> navigation-agent`
5. public-ish symbol naming
   - `RagSpecialistAgent -> RagAgent`
   - `delegate_to_navigation_specialist -> delegate_to_navigation_agent`
   - `_delegate_to_rag_specialist -> _delegate_to_rag_agent`
   - 其他 active symbol 若仍承载 `specialist` 语义，也必须同步改到 `agent`
6. archive rule
   - active canonical truth 必须改
   - historical archive 默认不改，除非仍被 active docs / tests / tooling 当 current truth 消费

## Execution Slices

### Slice 1: Package And Module Cutover

- move workspace dirs 到 `packages/rag-agent`、`packages/navigation-agent`
- move `src/campus_rag_specialist`、`src/campus_navigation_specialist` 到新的 module roots
- update corresponding `pyproject.toml`
- update dependent workspace packages 的 distribution deps / import paths
- rename package-local `README.md` / `AGENTS.md` 的 current-truth wording

### Slice 2: Python Runtime And Symbol Cutover

- update `packages/contracts/src/campus_contracts/models.py`
  - `SpecialistTarget`
  - allowed target tuples
- update `packages/supervisor-core`
  - agent delegate registry
  - routing / framing / response / audit / tool-policy
- update `packages/evals`
  - runtime target assertions
  - package imports / helper imports
- update Python tests
  - contracts / supervisor / specialist / evals / workspace layout
  - test file names 如仍承载 active canonical package naming，应一并改名

### Slice 3: JS/TS Runtime Target Cutover

- update `apps/app-api`
  - `selectedTarget` normalization / summaries / tests
- update `apps/protected-panel-web`
  - target filter option values
  - display label mappings
  - route/data-provider tests
- 保持 operator display label 继续由显式 mapping 派生，只是 raw target value 改成新的 agent label

### Slice 4: Active Docs And Planning Cutover

- update active architecture/docs entrypoints：
  - `README.md`
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/execution-and-agents-architecture.md`
  - `docs/architecture/target-architecture.md`
  - 其他 active supporting architecture / contract docs 若仍把 `rag-specialist` / `navigation-specialist` 写成 current truth
- update active planning truth：
  - `.planning/PROJECT.md`
  - `.planning/WORKSTREAMS.md`
  - 当前 active workstream docs
- historical archive 默认不进入本 slice，除非它破坏 current-truth search / tooling / entrypoint semantics

### Slice 5: Verification And Closeout

- run targeted Python verification
- run targeted JS/TS verification
- run `git diff --check`
- search for residual active canonical references
- 产出 `Phase 5` summary，明确 cutover 完成后的 new canonical truth

## Proposed Write Set

- `packages/rag-agent/**` from `packages/rag-specialist/**`
- `packages/navigation-agent/**` from `packages/navigation-specialist/**`
- `packages/supervisor-core/pyproject.toml`
- `packages/supervisor-core/src/campus_supervisor_core/{__init__.py,agent.py,audit.py,framing.py,response.py,routing.py,tool_policy.py}`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/evals/src/campus_evals/**`
- `apps/supervisor-api/src/campus_supervisor_api/{prompt_executor.py,prompt_stack.py}`
- `apps/app-api/src/modules/runtime-command/service/normalize.ts`
- `apps/app-api/test/**` 中承载 raw runtime target 的测试
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/test/**` 中承载 raw runtime target 的测试
- `tests/test_workspace_layout.py`
- `tests/contracts/**`
- `tests/supervisor/**`
- `tests/specialist/**`
- `tests/evals/**`
- `README.md`
- `docs/architecture/**` active current-truth docs
- active planning truth under `.planning/workstreams/execution-capability-family-convergence/`

## Verification Matrix

- filesystem / packaging
  - old package dirs no longer exist
  - new package dirs and new `src/<module>` roots exist
  - workspace dependencies point to `campus-rag-agent` / `campus-navigation-agent`
- Python contract/runtime
  - `SpecialistTarget` only admits `rag-agent` / `navigation-agent` plus already-agent families
  - supervisor still routes knowledge requests to the renamed raw runtime target
  - public imports resolve from `campus_rag_agent` / `campus_navigation_agent`
- JS/TS operator/runtime
  - `selectedTarget` normalization and panel filters accept renamed raw runtime target
  - operator summaries / display labels remain correct
- docs / planning
  - active canonical docs no longer describe `rag-specialist` / `navigation-specialist` as current runtime truth
  - historical archive retained only where it clearly remains historical

## Verification Commands

- `uv run --all-packages python -m unittest tests.test_workspace_layout tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.specialist.test_navigation_specialist tests.evals.test_golden_cases`
- `pnpm web:typecheck -- --filter=app-api --filter=protected-panel-web`
- `pnpm web:test -- --filter=app-api --filter=protected-panel-web`
- `git diff --check -- README.md .planning/WORKSTREAMS.md .planning/workstreams/execution-capability-family-convergence/ROADMAP.md .planning/workstreams/execution-capability-family-convergence/STATE.md docs/plans/execution-capability-family-convergence.md`
- `rg -n "rag-specialist|navigation-specialist|campus_rag_specialist|campus_navigation_specialist|campus-rag-specialist|campus-navigation-specialist|packages/rag-specialist|packages/navigation-specialist" README.md apps packages tests docs .planning/workstreams/execution-capability-family-convergence`

## Exit Rule

`Phase 5` 完成后，repo 应达到：

- active code truth 已统一切到 `rag-agent` / `navigation-agent`
- active docs / planning truth 已不再把 legacy `*-specialist` 当 current runtime truth
- `selected_target` / `selectedTarget` 继续保持 raw runtime target 语义，但 value 已完成 rename
- 不存在 compatibility shim、dual naming alias、或需要“后续再删”的过渡层
