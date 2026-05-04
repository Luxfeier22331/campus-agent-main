---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 5 Plan

## Objective

收口旧 heuristic shortcuts，把新的 rag-agent truth 写回 planning / architecture，并明确
remaining gap 与 reopen trigger。
该 phase 只有在前面 phase 已提供稳定 typed seam、planner-first runtime、multi-step
supporting evidence 与 observability contract 后才算可 close。

## Tasks

1. 降权或移除旧 answer-shape heuristic
   - `title_lookup` 不再是成功回答的核心条件
   - condition/detail/fact shape 只保留必要兼容性

2. 收敛 legacy decision logic
   - answer success 由 evidence / grounding 决定
   - 旧 helper 不能覆盖 stage truth

3. closeout 文档收口
   - 更新 roadmap / state
   - 记录 reopen rule
   - 必要时同步 architecture 文档
   - 写清楚已经 promotion 的 truth、仍 deferred 的 follow-up 与 reopen 条件

4. 形成最终验收说明
   - remaining gaps
   - follow-up trigger
   - maintenance posture
   - 把 reopen trigger 写成可审查的条件，而不是一句“后续如有需要再开”

## Constraints

- 不把 heuristic cleanup 变成新的隐式 fallback
- 不回退产品边界
- 不把 eval 变成唯一成功信号

## Verification

- targeted tests for heuristic removal / downgrade
- docs lint
- `git diff --check`
- closeout review that asserts phase 1-4 truths are stable before promotion

## Exit Criteria

- legacy shape heuristic 不再维持主语义
- workstream closeout 可作为后续 implementation reference
- reopen rule is explicit enough that a future reviewer can tell when this workstream must come back
