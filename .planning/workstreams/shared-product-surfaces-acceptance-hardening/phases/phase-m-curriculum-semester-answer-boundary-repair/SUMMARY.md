---
phase: "M"
name: "Curriculum Semester Answer Boundary Repair"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase M Summary

## What Closed

- 修复了 `program_semester_facts` 命中多个 partial chunk 时，public curriculum answer 把 chunk 边界碎片直接拼成损坏课程名的问题。
- 本轮确认 canonical semester fact truth 没坏；问题只在 `rag-specialist` 的 deterministic semester answer composition。
- fresh local browser smoke 已证明用户可见答案恢复为完整课程列表。

## Code Outcome

- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
  - 为 `program_semester_facts` 增加 deterministic semester-course assembly
  - 从 partial chunk snippet 中提取课程候选项、折叠边界残片并去重
  - 不再让这类 structured semester facts 走 generic snippet concatenation
- `tests/specialist/test_rag_specialist.py`
  - 增加 regression：
    - `test_curriculum_semester_answer_merges_program_semester_fact_partial_chunks_without_leaking_broken_course_fragments`

## Fresh Evidence

- regression red -> green:
  - `tests.specialist.test_rag_specialist.CurriculumQueryPlanningTest.test_curriculum_semester_answer_merges_program_semester_fact_partial_chunks_without_leaking_broken_course_fragments`
- full specialist lane:
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
  - `Ran 145 tests ... OK`
- local direct execution:
  - `POST http://127.0.0.1:8081/api/v1/answer`
  - clean answer returned for `法学民族班培养方案里大二下有什么课`
- local browser smoke:
  - `conversationId=ee0e20ac-7e56-4705-8a5a-ed919911c0c4`
  - `requestId=req_e96b9a09ed374ec28ee6231000c5e0f8`
  - `runtime.request_execution.answer_preview` confirms clean semester answer

## Additional Note

- smoke 过程中出现过 `Invalid bearer token`，但根因不是产品代码，而是 operator 把本地 `supervisor-api` 以默认 bearer 模式启动了。
- repo 既有 shared-product contract 没变：
  - `app-api` local worker 通过 `x-worker-origin-auth`
  - local `supervisor-api` 应以 `API_AUTH_MODE=trusted-worker` + `API_WORKER_SHARED_SECRET=<SUPERVISOR_API_SHARED_SECRET>` 启动

## Handoff

- `shared-product-surfaces-acceptance-hardening` 重新回到 completed。
- 如果未来再出现 public answer locator 泄漏，继续按 `Phase L` reopen。
- 如果未来再出现 semester-course chunk-boundary corruption，继续按 `Phase M` reopen。
