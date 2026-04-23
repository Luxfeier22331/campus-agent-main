---
workstream: repo-wide-codebase-decomposition
created: 2026-04-21
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 10
**Current Phase Name:** Reopened Regression Inventory Follow-up
**Current Plan:** `<none>`
**Total Phases:** 10
**Total Plans in Phase:** 0
**Progress:** 9/10 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Reopened inventory reappeared after recent notice
projection / MinerU / public-docs edits; three `800+` handwritten files are now
explicitly admitted in the baseline until the next isolated split tranche.

## Current Slice

- this workstream now owns repo-wide handwritten file decomposition only
- excluded by contract:
  - `vendor/**`
  - `pnpm-lock.yaml` / `uv.lock`
  - `apps/app-api/drizzle/meta/**`
  - other generated artifacts
- admitted oversized handwritten production files currently mapped into later phases:
  - `<none>`
- admitted oversized handwritten test/app files currently mapped into later phases:
  - `<none>`
- recently completed clean-tranche decompositions now below threshold:
  - `packages/rag-agent/src/campus_rag_agent/service.py`
  - `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py`
  - `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - `apps/official-web-collector/test/crawl.test.ts`
  - `apps/official-web-collector/test/page-artifacts.test.ts`
  - `apps/app-api/test/official-web-e2e.test.ts`
  - `apps/app-api/test/auth-and-db.test.ts`
  - `tests/evals/test_operator_observability.py`
  - `tests/ingestion/test_internal_notice_chunking_validation.py`
  - `tests/ingestion/test_internal_notice_scoped_rule_materialization.py`
  - `tests/ingestion/test_official_web_projection_chunking_audit.py`
  - `tests/ingestion/test_official_web_projection_import_worker.py`
  - `tests/ingestion/test_official_web_projection.py`
  - `tests/ingestion/test_processing_pipeline.py`
  - `tests/ingestion/test_handbook_chunking_validation.py`
  - `tests/ingestion/test_authenticated_notice_source_projections.py`
  - `tests/ingestion/test_process_raw_ingestion_job.py`
  - `tests/ingestion/test_authenticated_notice_closeout_async.py`
  - `tests/ingestion/test_handbook_cleanup.py`
  - `tests/ingestion/test_curriculum_chunking.py`
  - `tests/ingestion/test_provider_result_replay_rebuild.py`
  - `tests/ingestion/test_authenticated_notice_import.py`
  - `tests/ingestion/test_rebuild_local_data.py`
  - `tests/ingestion/test_chunking_policy.py`
  - `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - `tests/ingestion/test_registry_models.py`
  - `tests/ingestion/test_campusrag_ingestion_support.py`
  - `packages/contracts/src/campus_contracts/models.py`
  - `tests/contracts/test_models.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py`
  - `apps/app-api/scripts/seed-request-smoke.ts`
  - `apps/app-api/src/modules/operator-query/service.ts`
  - `apps/app-api/test/operator-query.route.test.ts`
  - `apps/app-api/test/chat-command.service.test.ts`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_multimodal_probe.py`
  - `packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging.py`
  - `packages/ingestion-core/src/campus_ingestion_core/registry.py`
  - `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
  - `packages/rag-agent/src/campus_rag_agent/agent.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_provider_normalize.py`
  - `apps/public-docs/scripts/sync_real_docs.py`
  - `apps/app-api/scripts/collection-rename-backfill.ts`
  - `tests/evals/test_golden_cases.py`
  - `tests/evals/test_ragas_runtime.py`
  - `tests/evals/test_retrieval_benchmark.py`
  - `tests/evals/test_handbook_benchmark.py`
  - `tests/evals/test_curriculum_live_benchmark.py`
  - `tests/retrieval/test_backend_qdrant.py`
  - `tests/specialist/test_rag_specialist.py`
  - `apps/protected-panel-web/test/worker.test.ts`
  - `apps/protected-panel-web/test/data-provider.test.ts`
  - `apps/authenticated-notice-collector/src/bootstrap-export.ts`
  - `apps/authenticated-notice-collector/src/file-release-export.ts`
  - `apps/authenticated-notice-collector/test/bootstrap-export.test.ts`
  - `tests/api/test_supervisor_api.py`
  - `tests/supervisor/test_supervisor_core.py`
  - `tests/retrieval/test_service.py`
  - `tests/ingestion/official_web_projection_listing_units_suite.py`
  - `tests/ingestion/official_web_projection_core_suite.py`
  - `tests/ingestion/processing_pipeline_policy_chunking_suite.py`
  - `tests/specialist/rag_specialist_curriculum_family_facts_suite.py`
  - `tests/specialist/rag_specialist_request_prompt_suite.py`
  - `tests/specialist/rag_specialist_curriculum_resolution_suite.py`
  - `tests/specialist/rag_specialist_official_web_suite.py`
  - `tests/specialist/rag_specialist_curriculum_structured_lookup_suite.py`
  - `tests/evals/retrieval_benchmark_qrels_suite.py`
  - `tests/evals/ragas_runtime_http_transport_suite.py`
  - `tests/evals/curriculum_live_benchmark_executor_suite.py`
  - `tests/evals/ragas_runtime_scorer_suite.py`
  - `tests/evals/formal_benchmark_repair_suite.py`
  - `tests/retrieval/backend_qdrant_execution_suite.py`
  - `tests/retrieval/backend_qdrant_curriculum_ranking_suite.py`
- current planning rule:
  - inventory freeze contract:
    - current mandatory set is every existing handwritten `800+` line code/test file in the repo
    - sub-800 files only enter this workstream when they already show obvious multi-owner monolith shape
  - repo-owned gate contract:
    - `pnpm decomposition:lint` / `scripts.check_decomposition_tracked` is the canonical audit lane for tracked handwritten `py/ts/tsx/js/jsx/mjs/cjs`
    - `configs/lint/decomposition-baseline.json` freezes the current admitted `800+` inventory and must shrink, not grow
    - fail-close semantics are: no new over-threshold tracked file, no baseline entry growth, and no resolved file lingering in baseline
  - every later phase must split by cohesive owner boundary, not by arbitrary line count
  - every phase must keep behavior stable and run targeted regressions before claiming completion

- reopened regression inventory:
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
  - `tests/ingestion/test_curriculum_provider_normalize.py`
  - `tests/test_public_docs_sync.py`

## Blockers

- no hard external blocker; current blocker is work not yet split
- these three files must be decomposed in a dedicated follow-up tranche instead of remaining as silent drift

## Verification

- `git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs" "*.py" | while IFS= read -r f; do if [ -f "$f" ]; then wc -l "$f"; fi; done | sort -nr | head -n 80`
- manual inventory review against generated/vendor exclusions
- `uv run --all-packages python -m unittest tests.test_check_lint_coverage_tracked tests.test_check_decomposition_tracked`
- `pnpm decomposition:lint`
- `uv run --all-packages python -m unittest tests.ingestion.test_official_web_handoff_consumer`
- `pnpm --filter app-api test:node -- test/request-smoke-seed.test.ts`
- `pnpm --filter app-api test:node -- test/chat-command.service.test.ts test/operator-query.service.test.ts test/operator-query.route.test.ts`
- `uv run --all-packages python -m unittest tests.ingestion.test_registry_models`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_budget_evaluation`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_chunking`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_multimodal_probe`
- `uv run --all-packages python -m unittest tests.ingestion.test_probe_curriculum_course_maps_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_docs_surface`
- `uv run --all-packages python -m unittest tests.ingestion.test_processing_pipeline`
- `uv run --all-packages python -m unittest tests.test_public_docs_sync`
- `pnpm exec vitest run -c vitest.node.config.mts test/collection-rename-backfill.test.ts` (workdir: `apps/app-api`)
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_provider_normalize tests.ingestion.test_source_truth_quality_gate`
- `uv run --all-packages python -m unittest tests.specialist.test_rag_prompting tests.specialist.test_rag_specialist`
- `uv run --all-packages python -m unittest tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.retrieval.test_service`
- `uv run --all-packages python -m unittest tests.ingestion.test_official_web_projection tests.ingestion.test_processing_pipeline tests.specialist.test_rag_specialist tests.evals.test_retrieval_benchmark tests.evals.test_ragas_runtime tests.evals.test_curriculum_live_benchmark tests.evals.test_formal_benchmark tests.retrieval.test_backend_qdrant`

## Session Continuity

**Stopped At:** reopened decomposition inventory has been re-admitted in the
baseline; next step is a dedicated split tranche for the three remaining
oversized files.
**Resume File:** .planning/workstreams/repo-wide-codebase-decomposition/STATE.md
