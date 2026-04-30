---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 8 Acceptance Docs And Closeout

## Goal

Close the workstream with verified focused gates, updated architecture/runbook truth, and clear
follow-up triggers.

## Requirements

- All planned correctness gates are implemented or explicitly deferred with reason.
- Docs reflect current merged/worktree truth.
- Focused ingestion/retrieval/backup/eval tests pass.
- Repo-wide residual failures are documented separately if still unrelated.
- Workstream can move to completed or stay active with a single explicit blocker.

## Implementation Tasks

1. Run final focused verification.
   - ingestion release tests.
   - retrieval backend/service tests.
   - qdrant backup tests.
   - eval runner tests.
   - docs lint.

2. Update docs.
   - `docs/architecture/system/data-plane-architecture.md` if chain semantics changed.
   - `docs/architecture/system/retrieval-serving-architecture.md`.
   - `docs/reference/runtime-serving-and-index-terms.md`.
   - release / backup runbooks as needed.

3. Update workstream state.
   - Phase completion summaries.
   - Evidence artifact paths.
   - Residual risks.
   - Reopen rule.

4. Update `.planning/WORKSTREAMS.md`.
   - Move to completed if all gates pass.
   - Otherwise leave active with exact blocker.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service
pnpm docs:lint
```

Run repo-wide unittest only as reporting evidence if the worktree is not polluted by unrelated
parallel changes:

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

## Done Criteria

- Workstream state accurately reflects implementation and verification.
- No stale docs contradict release/retrieval truth.
- Follow-up triggers are explicit.
