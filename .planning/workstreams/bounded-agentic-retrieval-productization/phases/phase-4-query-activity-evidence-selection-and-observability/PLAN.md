---
doc_type: plan
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 4 Plan

## Objective

把 repo 已经存在的 `query activity / supporting evidence / raw retrieved trace` building blocks 收口成正式的 operator-safe observability contract，为后续 eval/runtime acceptance 提供稳定 carrier。

## Tasks

1. 冻结 query activity 最小字段集
   - 对齐 `RetrievalStepActivity`、`RetrievalExecutionResult.step_activities` 与
     `docs/data/retrieval-query-activity-model.md`
   - 明确哪些字段属于：
     - internal execution truth
     - operator-safe debug truth
     - browser-facing evidence truth

2. 冻结 supporting evidence 与 raw trace 的边界
   - 审计 `rag-agent` 的 supporting-evidence selection
   - 审计 `supervisor-core` 的 retrieved-sources projection
   - 明确：
     - candidate set
     - retrieved sources
     - supporting evidence
     三者的 owner 和投影边界

3. 收口 observability contract
   - 为 `retrieval-core -> rag-agent -> supervisor/app-api` 定义最小 debug contract
   - 固定：
     - request/plan/step terminal state
     - step summary
     - candidate/supporting counts
     - fail-close / blocked semantics
   - 明确禁止把 raw snippet dump 直接暴露给 panel/browser

4. 补测试与 closeout evidence
   - retrieval:
     - step activity shape / terminal state
   - specialist:
     - supporting evidence 仍是 raw retrieved evidence 的受控子集
   - supervisor:
     - operator observability 不回退成 raw trace mirror

5. 更新 supporting docs
   - 必要时同步更新：
     - `docs/data/retrieval-query-activity-model.md`
     - `docs/architecture/system/retrieval-serving-architecture.md`
     - `docs/contracts/app-api-supervisor-execution.md`
   - 只收口已实现 truth，不扩写新的 product scope

## Constraints

- 不把 `Phase 4` 扩成新的 planner/executor phase
- 不把 official-web 时效 query 借 observability 再塞回 `rag-agent`
- 不把 raw retrieved snippet dump 直接暴露到 browser/panel
- 不引入 general web fallback 或新的 live provider owner

## Verification

- planning artifacts:
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/CONTEXT.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/RESEARCH.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/PLAN.md`
- targeted code verification when implementation starts:
  - `uv run --all-packages python -m unittest tests.retrieval.test_service`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
  - `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core`
  - `uv run --all-packages python -m unittest tests.evals.test_supplemental_adapters`
- hygiene:
  - `git diff --check` 通过

## Exit Criteria

- repo 已冻结 query activity / supporting evidence / raw trace 的最小正式边界
- operator-safe observability contract 与 browser-facing evidence contract 不再混淆
- `Phase 5` 可以基于同一套 carrier 做 eval/runtime acceptance closeout
