---
phase: "5"
name: "One-Shot Full Rename Execution"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 5 Summary

## What Closed

- `Phase 5` 已完成 one-shot full rename execution；`rag-specialist` / `navigation-specialist` 不再作为 active canonical runtime truth 存在。
- repo 当前 canonical current-truth 已统一为：
  - runtime/package/ADR label：`rag-agent`、`navigation-agent`
  - raw runtime target value：`rag-agent`、`navigation-agent`
  - Python distribution / module：`campus-rag-agent` / `campus_rag_agent`、`campus-navigation-agent` / `campus_navigation_agent`
- `selected_target` / `selectedTarget` 语义保持不变：
  - 继续只表示 raw runtime target
  - 没有被重写成 capability family、operator display label 或其他派生字段
- active architecture / contract / decision truth 已同步收口，不再把 `rag-agent` / `navigation-agent` 写成“未来才会迁移”的 forward alias。
- 本 phase 没有引入 compatibility shim、dual naming alias、temporary wrapper 或“以后再删”的过渡层。

## Fresh Evidence

- `packages/rag-agent/pyproject.toml`
- `packages/navigation-agent/pyproject.toml`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/decisions/adr-0027-navigation-agent-and-spatial-truth.md`
- `tests/test_workspace_layout.py`

## Verification

- `rg -n "rag-specialist|navigation-specialist|packages/rag-specialist|packages/navigation-specialist|campus_rag_specialist|campus_navigation_specialist|campus-rag-specialist|campus-navigation-specialist|RagSpecialistAgent|delegate_to_navigation_specialist|_delegate_to_rag_specialist" packages apps tests README.md docs/architecture docs/contracts docs/decisions .planning/PROJECT.md`
  - passed with no matches
- `git diff --check -- README.md .planning/PROJECT.md docs/architecture/current-architecture.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/target-architecture.md docs/contracts/app-api-supervisor-execution.md docs/decisions/adr-0027-navigation-agent-and-spatial-truth.md packages/contracts/src/campus_contracts/models.py`
  - passed
- `uv run --all-packages python -m unittest tests.test_workspace_layout tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.specialist.test_navigation_specialist tests.evals.test_golden_cases`
  - passed
  - `297` tests
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

## Closeout

- `Phase 5` 已正式 completed。
- 这条 workstream 的原始目标已经完成；后续只有在 repo 重新 admission runtime naming 改写、`selected_target` / `selectedTarget` 语义变更，或新增 capability family 需要重开 naming convergence 规则时，才需要 reopen。
