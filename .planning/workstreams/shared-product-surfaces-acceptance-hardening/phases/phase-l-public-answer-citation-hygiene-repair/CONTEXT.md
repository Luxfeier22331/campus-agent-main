---
phase: "L"
name: "Public Answer Citation Hygiene Repair"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase L Context

## Goal

修复 public chat 浏览器答案中泄漏内部 source locator 的问题：用户可见 `answer_text` 不再出现 `doc_id#chunk_id`、`source-faithful`、`chunk-*` 这类内部定位标记，但 structured evidence / observability 继续保留 operator-safe source trace。

## Current Truth

- `shared-product-surfaces-acceptance-hardening` 在 `Phase K` 后已经 closed。
- 本轮 local smoke 发现 public curriculum answer 会把内部 locator 直接拼进最终答案，例如：
  - `program_semester_facts:...#...:source-faithful:...:chunk-0001`
- 这不是前端渲染问题，而是执行侧 deterministic answer composition 泄漏：
  - `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `app-api` finalize path 也没有对 browser-facing assistant text 做 contract guard：
  - `apps/app-api/src/modules/runtime-command/service/writes.ts`
- 现有 contract 已明确 source identifiers 应留在 structured/operator-safe channels，而不是直接暴露成 browser prose：
  - `docs/contracts/app-api-supervisor-execution.md`

## Why This Phase Exists

这次问题不是“视觉小瑕疵”，而是 public answer contract breach：

- 用户可见答案被内部 locator 污染
- public chat answer prose 与 operator/source trace 没有分层
- 如果只在前端做正则止血，会继续放任 shared backend seam 输出错误 browser contract

因此必须按 workstream phase 修复，并回到正确边界处理。

## Locked Decisions

### Boundary Decision

- 主修复点放在 `rag-specialist` deterministic answer composition。
- `app-api` 只补 browser-facing defense-in-depth guard，不承担主文案生成。

### Contract Decision

- source trace 继续保留在：
  - `result.evidence.sources`
  - request observability / operator projection
- user-facing `answer_text` 不再携带 raw locator。

### Scope Decision

- 本 phase 只修 answer citation hygiene。
- 不重开 auth shell、Turnstile、panel、operator query 或 retrieval serving surface admission。

## Existing Code Insights

### Leak Path

- `_compose_generic_answer()` 直接把 `[{source.doc_id}#{source.chunk_id}]` 拼进 prose。
- `_compose_curriculum_semester_course_list_answer()` / `_compose_procedure_answer()` / official-web deterministic answer path 也会追加 `_format_source_citation(...)`。

### Browser Contract Gap

- `app-api` finalize path 把 upstream `answerText` 原样写入：
  - assistant message
  - `answer.result.text`
  - request preview

### Regression Surfaces

- Python specialist regression:
  - `tests/specialist/test_rag_specialist.py`
- TS app-api regression:
  - `apps/app-api/test/chat-command.service.test.ts`

## Non-goals

- 不做前端 regex cleanup
- 不改 operator trace / source projection contract
- 不修改 retrieval candidate trace 的持久化
- 不改 prompt executor、panel request projection 或 auth flow

## Canonical References

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `apps/app-api/src/modules/runtime-command/service/normalize.ts`
- `apps/app-api/src/modules/runtime-command/service/writes.ts`
- `tests/specialist/test_rag_specialist.py`
- `apps/app-api/test/chat-command.service.test.ts`
