---
phase: "2"
name: "Current-Truth Contract Label Migration"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Summary

## What Closed

- 把 `selected_target` / `selectedTarget` 的语义正式收口为 current runtime target，不再混用为 forward family label 或 operator-facing display label。
- 在 `docs/contracts/app-api-supervisor-execution.md`、`docs/contracts/app-api-http.md`、`docs/contracts/app-api-operator-observability-http.md`、`docs/data/app-api-schema.md` 中写实：
  - current serialized contract 继续只承载 raw runtime target
  - operator 友好名称必须由 app-owned mapping / presentation layer 派生
  - future family grouping 如有需要，必须走显式新字段或 projection
- 给 `protected-panel-web` 收口了当前 target filter / label 闭集，不再只对 `rag-specialist` 做单点特判。
- 修复了 panel 默认测试门只跑 worker lane 的缺口；`pnpm --dir apps/protected-panel-web test` 现在会先跑 node-side vitest，再跑 worker lane。
- 把本 phase 中误混入的 target-state agentic retrieval forward extension 文档块撤回，保持 Phase 2 只处理 current-truth contract / operator label migration。

## Fresh Evidence

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/PLAN.md`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/test/request-formatters.test.ts`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`

## Verification

- `pnpm --dir apps/protected-panel-web test`
  - passed
  - node lane: `17` files, `90` tests
  - worker lane: `1` file, `63` tests
- `uv run --all-packages python - <<'PY' ...`
  - passed
  - 验证当前 runtime target 闭集为 `rag-specialist`、`navigation-specialist`、`campus-services-agent`、`notice-agent`
  - 验证 `rag-agent` 仍被拒绝进入当前 serialized contract
- `git diff --check -- apps/protected-panel-web/package.json apps/protected-panel-web/src/panel/pages/audit-page.tsx apps/protected-panel-web/src/panel/pages/cost-page.tsx apps/protected-panel-web/src/panel/pages/overview-page/constants.ts apps/protected-panel-web/src/panel/pages/quality-page/constants.ts apps/protected-panel-web/src/panel/pages/safety-page/constants.ts apps/protected-panel-web/src/panel/requests/request-formatters.ts apps/protected-panel-web/test/request-formatters.test.ts docs/contracts/app-api-supervisor-execution.md docs/contracts/app-api-http.md docs/contracts/app-api-operator-observability-http.md docs/data/app-api-schema.md`
  - passed

## Handoff

- `Phase 2` 已正式 completed。
- 下一步进入 `Phase 3: Prompt Eval And Observability Label Convergence`。
- `Phase 3` 只处理 prompt / eval / observability wording convergence，不再回头重做 `selected_target` / operator display label 的 current-truth 语义清理。
- 并发中的 availability 删除线不属于本 phase 收口对象；本 phase 只以当前 non-forward serialized target 语义为基线完成收口。
