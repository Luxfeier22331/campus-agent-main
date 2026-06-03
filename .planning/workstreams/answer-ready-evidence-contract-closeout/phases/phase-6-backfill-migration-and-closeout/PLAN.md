---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Backfill, Migration And Closeout

## Goal

Apply the new evidence contract to admitted `student_rules` chunks and close the workstream with
proof that runtime behavior, release gates and docs agree.

## Tasks

1. Rebuild `student_rules` chunks using the updated chunk profile and metadata extraction.
2. Run chunk quality gate and inspect real sample markdown / JSONL output.
   - Confirm rebuilt target `student_rules` samples have `0` primary text-cue cases.
   - Confirm legacy cue diagnostics remain available for old-index quarantine samples.
3. Run targeted retrieval and RAG E2E samples:
   - `处分怎么消`
   - `哪些情况不能解除处分`
   - `成绩没前十还能评国奖吗`
   - `论文能不能算国奖条件`
   - `本科生有哪些奖学金能申请`
   - `奖学金怎么申请`
4. Verify old-index compatibility posture.
   - If new fields are optional, old indexes remain readable.
   - If release gate requires new fields, document migration path and fail-close behavior.
   - Old-index quarantine must not weaken rebuilt `student_rules` release admission.
5. Decide `institutional_rules` follow-up.
   - If same regulation chunker applies directly, add adoption notes.
   - If not, create seed/follow-up and do not silently expand scope.
   - Full institutional backfill is not a closeout blocker unless Phase 0 explicitly promoted it to
     mandatory scope.
6. Update docs.
   - `docs/policies/student-handbook-chunking-and-validation-policy.md`
   - `docs/architecture/system/retrieval-serving-architecture.md`
   - `docs/architecture/system/agentic-retrieval-architecture.md` if target truth changes.
   - If `docs/architecture/system/retrieval-serving-architecture.md` is touched, resolve the known
     existing docs-lint line-length blocker rather than carrying it into closeout.
7. Update planning.
   - Workstream `STATE.md`.
   - `.planning/WORKSTREAMS.md` registry.
   - Completion summary and reopen rule.

## Acceptance

- New chunks carry answer-ready metadata.
- Targeted E2E samples pass with stage-local diagnostics available.
- Rebuilt target samples prove typed evidence metadata, not text cues, is the primary
  ranking/selection signal.
- Release gate blocks missing contract fields.
- Docs accurately distinguish current merged truth, worktree-local truth and target architecture.
- `institutional_rules` has an explicit adoption decision or follow-up seed.
- Remaining risks are explicit.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_handbook_chunking_pipeline \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release_acceptance_wiring \
  tests.evals.retrieval_chunk_quality_suite \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.agent.rag_agent_realistic_e2e_samples_suite \
  tests.agent.rag_agent_answer_quality_regression_suite -q
pnpm docs:lint
uv run --all-packages ruff check packages/ingestion-core packages/retrieval-core packages/rag-agent packages/evals \
  tests/ingestion/test_handbook_chunking_pipeline.py \
  tests/ingestion/test_index_release_acceptance.py \
  tests/ingestion/test_registry_scope_release_acceptance_wiring.py \
  tests/evals/retrieval_chunk_quality_suite.py \
  tests/retrieval/backend_qdrant_curriculum_ranking_metadata_suite.py \
  tests/retrieval/retrieval_service_replan_execution_suite.py \
  tests/agent/rag_agent_realistic_e2e_samples_suite.py \
  tests/agent/rag_agent_answer_quality_regression_suite.py
```
