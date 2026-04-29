---
workstream: bounded-agentic-retrieval-productization
created: 2026-04-21
updated: 2026-04-22
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 5
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-22
**Last Activity Description:** Completed `Phase 5`, froze the acceptance matrix and runtime acceptance carrier, routed non-retrieval gaps out of scope, and moved the workstream to completed truth.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/CONTEXT.md`
  - research: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/RESEARCH.md`
  - plan: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/PLAN.md`
  - summary: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/SUMMARY.md`

- `Phase 1` doc freeze outputs:
  - contract: `docs/contracts/rag-agent-retrieval-plan-contract.md`
  - data model: `docs/data/retrieval-query-activity-model.md`

- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/CONTEXT.md`
  - research: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/RESEARCH.md`
  - plan: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/PLAN.md`
  - summary: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/SUMMARY.md`

- `Phase 2` implementation outputs:
  - code-level `RetrievalPlan / RetrievalStep / StepResult`
  - `rag-agent` ordered plan emission
  - `retrieval-core` multi-step kernel
  - `retrieve_sources(...)` 的 bounded compatibility path
  - compare dual-step execution 与 bounded replan fail-close

- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/CONTEXT.md`
  - research: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/RESEARCH.md`
  - plan: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/PLAN.md`
  - summary: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/SUMMARY.md`

- `Phase 3` completed implementation slice:
  - `rag-agent` / planner 已支持 generic `freshness_sensitive` 与 `live_assisted` plan emission
  - `build_ordered_retrieval_plan(...)` 已对 `freshness_sensitive` 发出 `freshness_gate -> indexed_lookup`
  - `retrieval-core` 已执行 `freshness_gate`，在 local freshness 不满足时 fail-close 并短路 indexed lookup
  - `build_ordered_retrieval_plan(...)` 已按 collection/query-mode 发出 source-trust policy：
    - `curriculum/* -> T0`
    - `student_rules -> T1`
    - `stable_reference -> T2`
    - `freshness_sensitive / live_assisted -> T3`
  - `retrieval-core` 已把 source-trust prefilter 前移到 merged evidence，但当前只对 `freshness_sensitive / live_assisted` branch 生效
  - `retrieval-core` 已为 `live_source_lookup` 提供 runtime-owned executor injection seam；未提供 callback 时继续 fail-close 为 unavailable path，而不是继续落回黑盒 browse
  - 本次已撤回 `rag-agent` 对 official-web freshness query 的 `live_assisted` 自动升级、repo-owned default live provider seam、以及 `stable_reference -> fresh_news` 的 runtime-profile truth
  - current product boundary 恢复为：official-web 的时效问题不属于 `rag-agent` 消费面；若误路由到 `rag-agent`，specialist 继续按 `freshness_fail_close` 返回
  - targeted tests 当前保留 generic `live_assisted` plan / executor seam coverage，并移除了 official-web `rag-agent -> fresh_news` 自动消费路径断言
  - `Phase 3` 已运行并通过：
    - `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.specialist.test_rag_retrieval_plan tests.specialist.test_rag_specialist tests.retrieval.test_service`
    - `git diff --check -- packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/retrieval_plan.py packages/retrieval-core/src/campus_retrieval_core/service.py packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`

- current `Phase 4` artifacts:
  - context: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/CONTEXT.md`
  - research: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/RESEARCH.md`
  - plan: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/PLAN.md`
  - summary: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-4-query-activity-evidence-selection-and-observability/SUMMARY.md`

- `Phase 4` repo facts already present:
  - `packages/retrieval-core/src/campus_retrieval_core/models.py` 已有 `RetrievalStepActivity`
  - `packages/retrieval-core/src/campus_retrieval_core/models.py` 的 `RetrievalExecutionResult` 已暴露 `step_activities`
  - `docs/data/retrieval-query-activity-model.md` 已冻结 `QueryActivity / StepActivity / SupportingEvidence` 分层
  - `packages/rag-agent/src/campus_rag_agent/service.py` 已将 supporting evidence 构造成 retrieved evidence 的受控子集
  - `packages/supervisor-core/src/campus_supervisor_core/response.py` 与 `tests/supervisor/test_supervisor_core.py` 已覆盖 raw retrieved sources 与最终 supporting evidence 分层
  - `packages/evals/src/campus_evals/retrieval_live_benchmark.py`、`packages/evals/src/campus_evals/official_web_live_benchmark.py` 与 `packages/evals/src/campus_evals/ragas_adapter.py` 已提供 retrieval / runtime acceptance building blocks
  - `packages/contracts/src/campus_contracts/models.py` 已冻结 `RetrievalPlanSummary / RetrievalStepActivitySummary`
  - `apps/app-api/src/modules/request-diagnostics.ts` 已解析 `retrieval_plan_summary`
  - `apps/app-api/src/modules/operator-query/store/requests.ts` 已通过 `diagnosticsJson.retrievalPlanSummary` 暴露 operator-safe retrieval plan detail
  - `apps/app-api/test/operator-query.store.test.ts` 已覆盖真实 store-path retrieval-plan projection，不再只依赖 route mock
  - `Phase 4` 已运行并通过：
    - `uv run --all-packages python -m unittest tests.contracts.test_models tests.specialist.test_rag_specialist`
    - `pnpm --filter app-api exec vitest run test/request-diagnostics.test.ts test/operator-query.route.test.ts test/operator-query.store.test.ts`
    - `git diff --check -- packages/contracts/src/campus_contracts/models.py apps/app-api/src/modules/operator-query/store/requests.ts apps/app-api/test/operator-query.store.test.ts docs/contracts/app-api-operator-observability-http.md docs/data/retrieval-query-activity-model.md`

- current `Phase 5` artifacts:
  - context: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/CONTEXT.md`
  - research: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/RESEARCH.md`
  - plan: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/PLAN.md`
  - summary: `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-5-eval-runtime-adoption-and-planning-closeout/SUMMARY.md`

- 当前已知 repo facts：
  - `rag-agent` 已通过 `build_ordered_retrieval_plan(...)` 发出 ordered plan
  - `retrieval-core` 已通过 `execute_retrieval_plan(...)` 执行 multi-step indexed lookup kernel
  - versioned-history query foundation 已完成，可直接作为 `Phase 3` 的 version/filter truth
  - generic freshness/live/source-trust typed seam 已成立，但 product-level admitted live consumer 仍需各自 workstream 明确 owner
  - structured runtime tool family 继续不属于 generic retrieval planning taxonomy
  - `Phase 5` 已冻结 acceptance matrix：
    - `tests.specialist.test_rag_retrieval_plan`
    - `tests.retrieval.test_service`
    - `tests.specialist.test_rag_specialist`
    - `tests.evals.test_retrieval_benchmark`
    - `tests.evals.test_golden_cases`
    - `tests.evals.test_supplemental_adapters`
  - `Phase 5` 已冻结 runtime acceptance carrier：
    - `packages/evals/README.md`
    - `app-api` internal eval ingress
    - `.planning/PROJECT.md` 中已记录的 handbook/curriculum acceptance artifact

## Blockers

- 无；这条 workstream 已完成。
- official-web 的时效 query owner、generic live consumer admission 与 non-current live ingress 现都已显式路由到 retrieval 线外。

## Session Continuity

**Stopped At:** workstream 已在 `Phase 5` 完成收口；后续只有在新的 retrieval step、concrete live consumer admission、或 retrieval-owned runtime acceptance contract 被重新 admission 时才恢复。
**Resume File:** `<none>`
