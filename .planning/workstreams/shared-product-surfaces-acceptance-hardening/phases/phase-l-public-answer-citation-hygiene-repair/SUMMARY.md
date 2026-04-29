---
phase: "L"
name: "Public Answer Citation Hygiene Repair"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase L Summary

## What Closed

- 修复了 deterministic `rag-specialist` user-facing prose 直接拼接 `doc_id#chunk_id` / `source-faithful` / `chunk-*` locator 的问题。
- `app-api` finalize path 现在会对 browser-facing assistant text 做 hygiene，避免未来 raw internal locator 再次穿透到 assistant message、`answer.result.text` 与 preview。
- supporting sources、request observability、operator-safe source trace 没有被删减，仍保留在 structured channels。

## Code Outcome

- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
  - 去掉 handbook / curriculum / official-web deterministic answer prose 中的 raw locator 拼接
- `apps/app-api/src/modules/runtime-command/service/normalize.ts`
  - 新增 `sanitizePublicAssistantText`
- `apps/app-api/src/modules/runtime-command/service/writes.ts`
  - finalize path 统一使用 hygiene guard
- `tests/specialist/test_rag_specialist.py`
  - 增加 locator hygiene regression
- `apps/app-api/test/chat-command.service.test.ts`
  - 增加 browser-facing finalize hygiene regression

## Fresh Evidence

- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts`

## Handoff

- `shared-product-surfaces-acceptance-hardening` 重新回到 completed。
- 如果未来再发现 public browser answer 泄漏 raw specialist locator，应继续在这条 workstream 下 reopen，不要退回前端止血方案。
