---
workstream: repo-wide-codebase-decomposition
created: 2026-04-21
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 8
**Current Phase Name:** Ingestion Test Decomposition II
**Current Plan:** `<none>`
**Total Phases:** 9
**Total Plans in Phase:** 0
**Progress:** 6/9 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Clean-lane fallback advanced into Phase 9. `packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py` now acts as a thin façade over split `*_shared.py` / `*_documents.py` / `*_probe.py` / `*_reporting.py` modules, and targeted `test_curriculum_budget_evaluation` plus `test_curriculum_chunking` both passed. Planning truth was also updated to remove already-subthreshold files from residual admission and to add newly confirmed `800+` suite debt.

## Current Slice

- this workstream now owns repo-wide handwritten file decomposition only
- excluded by contract:
  - `vendor/**`
  - `pnpm-lock.yaml` / `uv.lock`
  - `apps/app-api/drizzle/meta/**`
  - other generated artifacts
- admitted oversized handwritten production files currently mapped into later phases:
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`
  - `packages/ingestion-core/src/campus_ingestion_core/registry.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_multimodal_probe.py`
  - `packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging.py`
  - `packages/contracts/src/campus_contracts/models.py`
  - `apps/app-api/src/modules/operator-query/service.ts`
  - `apps/authenticated-notice-collector/src/bootstrap-export.ts`
  - `apps/authenticated-notice-collector/src/file-release-export.ts`
  - `apps/app-api/scripts/seed-request-smoke.ts`
- admitted oversized handwritten test/app files currently mapped into later phases:
  - `tests/retrieval/test_service.py`
  - `apps/app-api/test/chat-command.service.test.ts`
  - `apps/app-api/test/operator-query.route.test.ts`
  - `apps/protected-panel-web/test/worker.test.ts`
  - `tests/ingestion/test_registry_models.py`
  - `tests/api/test_supervisor_api.py`
  - `tests/supervisor/test_supervisor_core.py`
  - `apps/protected-panel-web/test/data-provider.test.ts`
  - `tests/contracts/test_models.py`
  - `tests/ingestion/test_campusrag_ingestion_support.py`
  - `apps/authenticated-notice-collector/test/bootstrap-export.test.ts`
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
  - `tests/evals/handbook_benchmark_repair_suite.py`
  - `tests/retrieval/backend_qdrant_execution_suite.py`
  - `tests/retrieval/backend_qdrant_curriculum_ranking_suite.py`
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
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py`
  - `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
  - `packages/rag-agent/src/campus_rag_agent/agent.py`
  - `tests/evals/test_golden_cases.py`
  - `tests/evals/test_ragas_runtime.py`
  - `tests/evals/test_retrieval_benchmark.py`
  - `tests/evals/test_handbook_benchmark.py`
  - `tests/evals/test_curriculum_live_benchmark.py`
  - `tests/retrieval/test_backend_qdrant.py`
  - `tests/specialist/test_rag_specialist.py`
- current planning rule:
  - inventory freeze contract:
    - current mandatory set is every existing handwritten `800+` line code/test file in the repo
    - sub-800 files only enter this workstream when they already show obvious multi-owner monolith shape
  - every later phase must split by cohesive owner boundary, not by arbitrary line count
  - every phase must keep behavior stable and run targeted regressions before claiming completion

## Blockers

- several remaining Phase 4 / 5 / 7 / 8 candidates are concurrently dirty in this worktree, so clean-tranche execution should keep advancing on later admitted files whose write sets remain uncontended instead of forcing shared edits
- Phase 8 still has two explicit admissions, `tests/ingestion/test_registry_models.py` and `tests/ingestion/test_campusrag_ingestion_support.py`, but both are already dirty from concurrent work in this worktree
- this workstream must stay independent from ongoing domain workstreams; do not smuggle business behavior changes into decomposition phases

## Verification

- `git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs" "*.py" | while IFS= read -r f; do if [ -f "$f" ]; then wc -l "$f"; fi; done | sort -nr | head -n 80`
- manual inventory review against generated/vendor exclusions
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_budget_evaluation`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_chunking`

## Session Continuity

**Stopped At:** `packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py` has been decomposed into façade + focused helper modules and verified. Phase 8 still has two dirty test admissions, so the next clean-lane fallback remains Phase 9 production decomposition on `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`.
**Resume File:** `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`
