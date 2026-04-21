---
workstream: eval
created: 2026-04-22
updated: 2026-04-22
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 1
**Current Phase Name:** Shared Eval Ownership And Contract Freeze
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 0/5 phases complete
**Last Activity:** 2026-04-22
**Last Activity Description:** Expanded `eval` to formally absorb golden dataset governance into Phase 2, while narrowing `golden-dataset-execution-plan.md` to a supporting reference instead of a parallel owner.

## Current Slice

- 这条 workstream 当前正式拥有 shared eval substrate 与 Phase 2 golden dataset governance contract：
  - `packages/evals`
  - coverage matrix / denominator truth
  - retrieval qrels / workflow-status / deterministic answer truth / synthetic candidate intake 的 shared case governance
  - shared deterministic / supplemental gate policy
  - benchmark artifact contract
  - repair / accept / publish lifecycle
  - eval ingress / request correlation shared seam
- 当前要先冻结的 owner 边界：
  - 哪些 truth 属于 shared eval
  - 哪些 truth 继续属于 handbook / curriculum / notice / runtime / retrieval workstream
  - `.planning/workstreams/eval/README.md` 与 `docs/plans/archive/superseded/golden-dataset-execution-plan.md` 之间的主从关系
  - operator publish/backflow 何时属于 eval shared seam，何时仍属于 `app-api` operator truth
  - CI / release-gate automation 应该如何引用 eval artifact，而不是反向定义 artifact
- 当前明确排除：
  - domain case authoring 本体
  - retrieval / panel / tool feature 实现
  - sink / grader 原始 payload 持久化真相

## Blockers

- 当前没有独立 blocker；这条 workstream 仍处于 Phase 1，下一步是把 owner / contract / non-goals 写实到可执行 phase plan。
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md` 现只保留为 Phase 2 supporting reference；active progression 已统一收口到这条原生 workstream。

## Verification

- planning/docs change only；本次未修改 runtime、retrieval、app-api 或 panel 代码
- `git diff --check -- .planning/WORKSTREAMS.md docs/plans/README.md docs/plans/archive/superseded/golden-dataset-execution-plan.md .planning/workstreams/eval/README.md .planning/workstreams/eval/REQUIREMENTS.md .planning/workstreams/eval/ROADMAP.md .planning/workstreams/eval/STATE.md`

## Session Continuity

**Stopped At:** `eval` workstream 已补齐 golden dataset governance owner 边界；下一次恢复应先输出 Phase 1 plan，再进入 Phase 2 的显式治理执行。
**Resume File:** `.planning/workstreams/eval/README.md`
