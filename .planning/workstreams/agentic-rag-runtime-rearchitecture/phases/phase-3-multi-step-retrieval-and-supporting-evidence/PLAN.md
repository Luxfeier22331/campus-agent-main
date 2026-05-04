---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 3 Plan

## Objective

把 bounded multi-step retrieval 真正接入 rag-agent，并把 supporting evidence selection
从单次结果摘取升级为可重规划、可解释、可验证的阶段。
本 phase 不重做 retrieval-core 的已完成 baseline；它只消费既有 typed plan / multi-step
能力，并把 rag-agent 的 upstream projections 和 replan semantics 接上去。

## Tasks

1. 定义 bounded multi-step seam
   - 明确何时允许 replan
   - 明确 step budget 与 terminal policy

2. 接入 upstream bounded context
   - 允许 typed projection 作为 planning input
   - 不接 raw transcript / raw provider trace
   - 只消费 admitted projection family，不重开开放式 context plumbing

3. 明确 supporting evidence selection
   - 每一步产出可追踪 evidence
   - evidence selection 不代持 planning truth
   - 每次 step 的 evidence 都能追到对应 plan / step / query activity

4. 验证 step 级 traceability
   - 每步可见、可归因、可复盘

## Constraints

- multi-step 仍然 bounded、fail-close
- 不扩大产品 scope
- 不让 structured runtime tool family 混入 generic retrieval planning

## Verification

- step-level targeted tests
- trace / evidence inspection
- `git diff --check`
- bounded multi-step case review that shows what changed relative to baseline and what did not

## Exit Criteria

- multi-step 只在 admitted case 中发生
- step 级证据链可被 eval 还原
- phase 3 可以清楚说明它只是在 baseline 之上增加 rag-agent runtime adapter，而不是重写
  retrieval-core owner
