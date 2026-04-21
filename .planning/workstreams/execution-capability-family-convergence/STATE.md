---
workstream: execution-capability-family-convergence
created: 2026-04-21
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 5
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Completed `Phase 5` one-shot full rename execution, closed the workstream, and promoted `rag-agent` / `navigation-agent` to the only active canonical runtime truth.

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
- `Phase 5` 已正式 completed：
  - `phases/phase-5-one-shot-full-rename-execution/CONTEXT.md`
  - `phases/phase-5-one-shot-full-rename-execution/RESEARCH.md`
  - `phases/phase-5-one-shot-full-rename-execution/PLAN.md`
  - `phases/phase-5-one-shot-full-rename-execution/SUMMARY.md`
  - one-shot full rename 已完成，active code/doc/test/planning truth 不再保留 `rag-specialist` / `navigation-specialist` current-truth alias
  - `selected_target` / `selectedTarget` 继续只表示 raw runtime target，但 admitted value 已统一为 `rag-agent` / `navigation-agent`
  - 当前这条 workstream 已完成；后续只有 future family naming rule 被显式改写时才 reopen

## Blockers

- 无；这条 workstream 已完成，后续只有在 repo 重新 admission runtime naming 改写、`selected_target` / `selectedTarget` 语义变更，或新增 capability family 需要重开 naming convergence 规则时才恢复

## Verification

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases.GoldenCaseSchemaTest tests.evals.test_golden_cases.RunCasesTest`
  - passed
  - 验证 runtime target / capability family split
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
  - passed
  - `225` tests
- `uv run --all-packages python -m unittest tests.test_workspace_layout tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.specialist.test_navigation_specialist tests.evals.test_golden_cases`
  - passed
  - `297` tests
- `git diff --check -- docs/architecture/prompt-and-instruction-architecture.md docs/architecture/operator-observability-architecture.md docs/contracts/app-api-operator-observability-http.md`
  - passed
- `git diff --check -- README.md .planning/PROJECT.md docs/architecture/current-architecture.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/target-architecture.md docs/contracts/app-api-supervisor-execution.md docs/decisions/adr-0027-navigation-agent-and-spatial-truth.md packages/contracts/src/campus_contracts/models.py`
  - passed
- `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/execution-capability-family-convergence/ROADMAP.md .planning/workstreams/execution-capability-family-convergence/STATE.md .planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md docs/plans/archive/completed/execution-capability-family-convergence.md .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/SUMMARY.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/CONTEXT.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/RESEARCH.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/PLAN.md .planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/SUMMARY.md`
  - passed
- `rg -n "one-shot full rename|Phase 5|compatibility shim|partial rename|rag-agent|navigation-agent" .planning/workstreams/execution-capability-family-convergence docs/plans/archive/completed/execution-capability-family-convergence.md .planning/WORKSTREAMS.md`
  - passed
  - 验证 `Phase 4 -> Phase 5` handoff、full rename admission 与拒绝 compatibility/partial rename 的 planning truth 已落盘
- `rg -n "rag-specialist|navigation-specialist|packages/rag-specialist|packages/navigation-specialist|campus_rag_specialist|campus_navigation_specialist|campus-rag-specialist|campus-navigation-specialist|RagSpecialistAgent|delegate_to_navigation_specialist|_delegate_to_rag_specialist" packages apps tests README.md docs/architecture docs/contracts docs/decisions .planning/PROJECT.md`
  - passed with no matches
- `pnpm exec turbo run typecheck --filter=app-api --filter=protected-panel-web`
  - passed
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/supervisor-adapter.test.ts test/projection.service.test.ts test/operator-query.service.test.ts test/operator-query.route.test.ts test/request-observability.test.ts test/chat-command.service.test.ts test/chat-requests.route.test.ts test/operator-observability-command.service.test.ts`
  - passed
  - `8` files / `82` tests
- `pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/request-formatters.test.ts test/data-provider.test.ts`
  - passed
  - `2` files / `16` tests
- `XDG_CONFIG_HOME=./.wrangler-home pnpm --dir apps/protected-panel-web exec vitest run -c vitest.config.mts test/worker.test.ts`
  - passed
  - `1` file / `63` tests

## Session Continuity

**Stopped At:** workstream 已在 `Phase 5` 完成收口；后续只有在 repo 重新 admission runtime naming 改写或新增 capability family 需要重开 convergence 规则时才恢复
**Resume File:** `<none>`
