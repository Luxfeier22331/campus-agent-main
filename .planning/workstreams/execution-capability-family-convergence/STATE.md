---
workstream: execution-capability-family-convergence
created: 2026-04-21
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 3
**Current Phase Name:** Prompt Eval And Observability Label Convergence
**Current Plan:** `phases/phase-3-prompt-eval-and-observability-label-convergence/PLAN.md`
**Total Phases:** 4
**Total Plans in Phase:** 1
**Progress:** 2/4 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Created the `Phase 3` planning pack to converge prompt / eval / observability wording while preserving `Phase 2` current runtime target semantics.

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
- 当前切片切到 `Phase 3`：
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/CONTEXT.md`
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/RESEARCH.md`
  - `phases/phase-3-prompt-eval-and-observability-label-convergence/PLAN.md`
  - 只处理 prompt / eval / observability wording convergence
  - 不回头重做 Phase 2 已完成的 current-truth contract 语义清理
  - 不提前进入 package dir / import path rename

## Blockers

- telemetry / eval / observability wording 仍然混有 `specialist` / `agent` 两套词汇。
- package dir / import path / runtime object rename 是否真的执行仍未冻结。
- 并发中的 availability 删除线不在这条 phase 的 write set 内；`Phase 3` 规划时只消费已合流的 current truth。

## Verification

- `pnpm --dir apps/protected-panel-web test`
  - passed
- `uv run --all-packages python - <<'PY' ...`
  - passed
  - 当前 runtime target contract 闭集与 forward label rejection 均符合预期
- `git diff --check -- apps/protected-panel-web/package.json apps/protected-panel-web/src/panel/pages/audit-page.tsx apps/protected-panel-web/src/panel/pages/cost-page.tsx apps/protected-panel-web/src/panel/pages/overview-page/constants.ts apps/protected-panel-web/src/panel/pages/quality-page/constants.ts apps/protected-panel-web/src/panel/pages/safety-page/constants.ts apps/protected-panel-web/src/panel/requests/request-formatters.ts apps/protected-panel-web/test/request-formatters.test.ts docs/contracts/app-api-supervisor-execution.md docs/contracts/app-api-http.md docs/contracts/app-api-operator-observability-http.md docs/data/app-api-schema.md`
  - passed

## Session Continuity

**Stopped At:** `Phase 3` planning pack created; next step is to execute prompt / eval / observability wording convergence without re-opening contract semantics or package rename
**Resume File:** docs/plans/execution-capability-family-convergence.md
