---
doc_type: plan
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 5 Plan

## Objective

用现有 eval / runtime acceptance building blocks 完成 bounded agentic retrieval 的最终 closeout，并把非 retrieval owner 的残余问题显式转交出去。

## Tasks

1. 冻结 acceptance matrix
   - 明确至少覆盖：
     - `current`
     - `historical`
     - `as_of`
     - `compare`
     - `freshness fail-close`
     - admitted `live_source_lookup` seam
   - 区分 deterministic gate 与 supplemental evidence

2. 绑定 runtime acceptance carrier
   - 对齐 `packages/evals`、`app-api` internal eval ingress、request correlation 与 acceptance artifact
   - 明确 closeout 以哪些 artifact 为准

3. 审计 residual gaps
   - 明确哪些 gap 仍属于 retrieval owner
   - 明确哪些 gap 已属于：
     - tool/runtime owner
     - official-web/news opening
     - notice/service runtime

4. 更新 planning/docs
   - 更新本 workstream 的 `STATE/ROADMAP/SUMMARY`
   - 必要时更新 `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md`
   - 把不属于 retrieval owner 的问题显式写回对应 workstream 或 backlog

5. 形成 closeout verdict
   - 给出：
     - completed
     - residual risks
     - reopen conditions

## Constraints

- 不把 `Phase 5` 变成新的 feature phase
- 不用 retrieval workstream 代偿 official-web/tool/runtime owner 缺口
- supplemental judge/ragas 不能替代 deterministic acceptance

## Verification

- planning artifacts:
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/CONTEXT.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/RESEARCH.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/PLAN.md`
- targeted verification when implementation starts:
  - `uv run --all-packages python -m unittest tests.evals.test_retrieval_benchmark tests.evals.test_supplemental_adapters`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.supervisor.test_supervisor_core`
  - 需要 live acceptance 时，仅运行与被验收 collection 直接相关的 benchmark CLI
- hygiene:
  - `git diff --check` 通过

## Exit Criteria

- bounded agentic retrieval 的 acceptance matrix 已冻结
- runtime acceptance artifact 与 closeout verdict 已形成
- 非 retrieval owner 的剩余问题已被显式路由，不再停留在这条 workstream 内
