---
doc_type: phase_plan
phase: "M"
phase_name: "Curriculum Semester Answer Boundary Repair"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase M Plan

## Objective

把 curriculum semester answer contract 收回正确边界：structured `program_semester_facts` 命中多个 partial chunk 时，`rag-specialist` 仍输出稳定课程列表，而不是把 chunk 边界碎片原样拼进 browser-facing prose。

## Decisions To Freeze

1. 不接受前端止血作为主修复。
2. 不改 canonical `program_semester_facts` truth。
3. `program_semester_facts` answer composition 必须从 semester-course candidates 组装，而不是 generic snippet concatenation。
4. closeout evidence 必须包含 local public chat 浏览器 smoke，而不只停在单元测试。

## Execution Slices

### Slice 1: Reproduce And Lock The Defect

- 用 failing regression 固定 broken-fragment truth：
  - `tests/specialist/test_rag_specialist.py`
  - 断言 multi-chunk semester answer 不再泄漏 `中国民族史概要(一；`、`；展经济学` 这类碎片

### Slice 2: Move Semester Answers Onto Structured Composition

- 修改 `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- 为 `program_semester_facts` 新增 deterministic semester-course assembly：
  - 从 partial chunk snippets 提取课程候选项
  - 折叠边界残片
  - 去重并输出稳定课程列表
- 不动 other collection 的既有 answer path，避免横向扩散

### Slice 3: Re-close The Real Product Surface

- 用 local direct execution 证明 trusted-worker execution path 返回 clean answer
- 用 `public-chat-web` local browser smoke 证明真正用户可见答案已修复
- 从 local shared DB 记录 fresh `request_id` 与 `answer_preview`

### Slice 4: Reopen And Close Planning Truth

- 在当前 workstream 内新增 `Phase M`
- 更新：
  - `ROADMAP.md`
  - `STATE.md`
  - `WORKSTREAMS.md`
  - `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`

## Proposed Write Set

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/SUMMARY.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `tests/specialist/test_rag_specialist.py`

## Verification Loop

- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
- local direct execution:
  - `POST http://127.0.0.1:8081/api/v1/answer`
- local browser smoke:
  - ask `法学民族班培养方案里大二下有什么课`
  - verify visible answer does not contain:
    - `中国民族史概要(一；`
    - `；展经济学`
    - raw internal locator fragments
- local DB evidence:
  - `runtime.request_execution.request_id`
  - `answer_preview`

## Exit Rule

Phase M 完成后，repo 应达到：

- curriculum semester answer 不再输出 chunk-boundary corruption
- canonical semester fact truth 保持不变
- public browser answer contract 再次回到 deterministic、可读、无碎片的课程列表
- workstream 重新回到 completed
