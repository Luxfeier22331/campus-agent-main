---
workstream: repo-wide-codebase-decomposition
created: 2026-04-21
updated: 2026-04-22
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 5
**Current Phase Name:** App Surfaces And Collector Decomposition
**Current Plan:** `<none>`
**Total Phases:** 9
**Total Plans in Phase:** 0
**Progress:** 3/9 phases complete
**Last Activity:** 2026-04-22
**Last Activity Description:** Continued the clean-tranche decomposition pass on files whose write sets stayed uncontended. `apps/official-web-collector/test/crawl.test.ts` is now a thin suite registrar over `crawl-test-support.ts`, `crawl-core.suite.ts`, `crawl-control-plane.suite.ts`, and `crawl-cli.suite.ts`; `tests/ingestion/test_internal_notice_chunking_validation.py` is now a thin entry over `internal_notice_chunking_validation_test_support.py`, `internal_notice_chunking_validation_scan_suite.py`, `internal_notice_chunking_validation_report_suite.py`, and `internal_notice_chunking_validation_export_suite.py`. Fresh verification reran `pnpm --filter official-web-collector typecheck`, `pnpm --filter official-web-collector exec vitest run test/crawl.test.ts`, `pnpm --filter official-web-collector test`, and `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_chunking_validation` green.

## Current Slice

- this workstream now owns repo-wide handwritten file decomposition only
- excluded by contract:
  - `vendor/**`
  - `pnpm-lock.yaml` / `uv.lock`
  - `apps/app-api/drizzle/meta/**`
  - other generated artifacts
- admitted oversized handwritten production files currently mapped into later phases:
  - `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - `packages/evals/src/campus_evals/app_api_chat_runtime.py`
  - `packages/evals/src/campus_evals/ragas_adapter.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`
  - `packages/ingestion-core/src/campus_ingestion_core/registry.py`
  - `packages/contracts/src/campus_contracts/models.py`
  - `apps/app-api/src/modules/operator-query/service.ts`
  - `apps/authenticated-notice-collector/src/bootstrap-export.ts`
  - `apps/authenticated-notice-collector/src/file-release-export.ts`
  - `apps/app-api/scripts/seed-request-smoke.ts`
  - `packages/rag-agent/src/campus_rag_agent/agent.py`
  - `packages/rag-agent/src/campus_rag_agent/service.py`
  - `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- admitted oversized handwritten test/app files currently mapped into later phases:
  - `tests/specialist/test_rag_specialist.py`
  - `tests/retrieval/test_backend_qdrant.py`
  - `tests/ingestion/test_official_web_projection.py`
  - `tests/ingestion/test_authenticated_notice_source_projections.py`
  - `tests/ingestion/test_process_raw_ingestion_job.py`
  - `apps/official-web-collector/test/page-artifacts.test.ts`
  - `tests/evals/test_golden_cases.py`
  - `tests/ingestion/test_authenticated_notice_closeout_async.py`
  - `tests/evals/test_ragas_runtime.py`
  - `tests/evals/test_retrieval_benchmark.py`
  - `tests/ingestion/test_handbook_cleanup.py`
  - `tests/ingestion/test_handbook_chunking_validation.py`
  - `tests/ingestion/test_curriculum_chunking.py`
  - `apps/app-api/test/chat-command.service.test.ts`
  - `tests/ingestion/test_processing_pipeline.py`
  - `apps/app-api/test/operator-query.route.test.ts`
  - `tests/ingestion/test_provider_result_replay_rebuild.py`
  - `apps/protected-panel-web/test/worker.test.ts`
  - `tests/ingestion/test_rebuild_local_data.py`
  - `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - `tests/ingestion/test_registry_models.py`
  - `tests/evals/test_handbook_benchmark.py`
  - `tests/api/test_supervisor_api.py`
  - `tests/ingestion/test_official_web_handoff_consumer.py`
  - `tests/supervisor/test_supervisor_core.py`
  - `apps/protected-panel-web/test/data-provider.test.ts`
  - `tests/contracts/test_models.py`
  - `tests/evals/test_curriculum_live_benchmark.py`
  - `tests/evals/test_operator_observability.py`
  - `tests/ingestion/test_official_web_projection_chunking_audit.py`
  - `tests/ingestion/test_official_web_projection_import_worker.py`
  - `tests/ingestion/test_authenticated_notice_import.py`
  - `tests/ingestion/test_campusrag_ingestion_support.py`
  - `tests/ingestion/test_chunking_policy.py`
  - `apps/app-api/test/official-web-e2e.test.ts`
  - `apps/app-api/test/auth-and-db.test.ts`
  - `apps/authenticated-notice-collector/test/bootstrap-export.test.ts`
- current planning rule:
  - inventory freeze contract:
    - current mandatory set is every existing handwritten `800+` line code/test file in the repo
    - sub-800 files only enter this workstream when they already show obvious multi-owner monolith shape
  - every later phase must split by cohesive owner boundary, not by arbitrary line count
  - every phase must keep behavior stable and run targeted regressions before claiming completion

## Blockers

- no active implementation blocker right now; the earlier `uv run --all-packages ...` workspace failure was cleared by replacing the root `apps/*` uv member glob with an explicit list of Python-owned app members
- several remaining Phase 5 app/test candidates are concurrently dirty in this worktree, so clean-tranche execution should keep advancing on later admitted files whose write sets remain uncontended instead of forcing shared edits
- this workstream must stay independent from ongoing domain workstreams; do not smuggle business behavior changes into decomposition phases

## Verification

- `git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs" "*.py" | while IFS= read -r f; do if [ -f "$f" ]; then wc -l "$f"; fi; done | sort -nr | head -n 80`
- manual inventory review against generated/vendor exclusions

## Session Continuity

**Stopped At:** `apps/official-web-collector/test/crawl.test.ts` and `tests/ingestion/test_internal_notice_chunking_validation.py` are now below the workstream threshold via stable entry + support/suite splits. Because `apps/official-web-collector/test/page-artifacts.test.ts` and several other app-surface files are concurrently dirty in this worktree, the clean next-step queue moves to `tests/ingestion/test_official_web_projection_chunking_audit.py`, then `tests/ingestion/test_official_web_projection_import_worker.py` / `tests/ingestion/test_official_web_handoff_consumer.py`, before returning to remaining Phase 5 app surfaces when their write sets are clear.
**Resume File:** `tests/ingestion/test_official_web_projection_chunking_audit.py`
