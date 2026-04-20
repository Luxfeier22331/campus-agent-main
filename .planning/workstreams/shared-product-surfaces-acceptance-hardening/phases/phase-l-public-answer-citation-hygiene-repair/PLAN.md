---
doc_type: phase_plan
phase: "L"
phase_name: "Public Answer Citation Hygiene Repair"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase L Plan

## Objective

把 public answer contract 收回正确边界：deterministic specialist answer 只输出用户可读内容，source locator 只留在 structured evidence / observability，并在 `app-api` finalize path 对 browser-facing assistant text 增加 hygiene guard。

## Decisions To Freeze

1. 不接受前端正则止血作为主修复。
2. deterministic `rag-specialist` prose 不再拼接 `doc_id#chunk_id` / `source-faithful` locator。
3. `app-api` 对 assistant text 增加 defense-in-depth sanitizer；如果未来再次收到 internal locator，会先清除或 fail-close 成安全文案。
4. supporting sources、request observability、operator-safe source trace 继续完整保留。

## Execution Slices

### Slice 1: Lock The Leak With Failing Tests

- 在 `tests/specialist/test_rag_specialist.py` 增加回归断言：
  - handbook deterministic answer 不再包含 internal locator
  - curriculum semester deterministic answer 不再包含 internal locator
- 在 `apps/app-api/test/chat-command.service.test.ts` 增加回归断言：
  - completed answer finalize 到 browser-facing result / assistant message 前会做 hygiene

### Slice 2: Remove Locator Injection From Deterministic Specialist Prose

- 修改 `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- 去掉以下 deterministic prose 中的 raw locator 拼接：
  - generic answer
  - curriculum semester course list answer
  - procedure answer
  - official-web deterministic answer family
- 保持 `supporting_sources` 与最终 structured evidence 不变

### Slice 3: Add Browser-Facing Answer Hygiene Guard In App API

- 在 `apps/app-api/src/modules/runtime-command/service/normalize.ts` 新增 public assistant text sanitizer
- 在 `apps/app-api/src/modules/runtime-command/service/writes.ts` finalize path 统一使用
- sanitizer 规则：
  - 去除 bracketed internal locator fragments
  - 如果仍残留 internal locator pattern，则 fail-close 为安全用户文案

### Slice 4: Refresh Planning Truth

- 在当前 workstream 内新增 `Phase L`
- 更新：
  - `ROADMAP.md`
  - `STATE.md`
  - `WORKSTREAMS.md`
  - `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`

## Proposed Write Set

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/SUMMARY.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `apps/app-api/src/modules/runtime-command/service/normalize.ts`
- `apps/app-api/src/modules/runtime-command/service/writes.ts`
- `tests/specialist/test_rag_specialist.py`
- `apps/app-api/test/chat-command.service.test.ts`

## Verification Loop

- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts`
- regression truth:
  - deterministic handbook/curriculum answers no longer expose internal locator
  - `app-api` browser-facing answer text no longer exposes internal locator
  - structured evidence / observability source trace remains intact

## Exit Rule

Phase L 完成后，repo 应达到：

- public browser answer prose 不再含 raw source locator
- deterministic specialist path 与 browser contract 边界重新对齐
- operator-safe source trace 仍可用于 observability / panel / diagnostics
- workstream 可重新回到 completed
