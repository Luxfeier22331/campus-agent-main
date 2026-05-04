---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Selected-Write Read-Model Migration

## Goal

Publish grouped service-guide facts through ingestion-owned selected-write release and PostgreSQL
typed read model without breaking existing flat consumers.

## Inputs

- Phase 1 `SUMMARY.md`
- Phase 2 `SUMMARY.md`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- `apps/supervisor-api/internal/structuredquery/service_guide_types.go`
- `apps/supervisor-api/internal/structuredquery/service_guide.go`
- `tests/ingestion/test_release_official_web_selected_write.py`
- `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`

## Tasks

1. Extend selected-write release projection with grouped procedure fields and selected/focused
   metadata required by the contract.
2. Preserve flat `guide_sections` and existing `entry_refs` compatibility semantics.
3. Define typed read-model migration:
   - persistence shape
   - schema version handling
   - backfill or compatibility projection for old records
   - rollback behavior for mixed old/new records
4. Ensure ingestion worker owns mutation:
   - app-api only consumes operator-safe projection
   - no app-api selected-write task mutation path
5. Preserve task-scope/full-impact count semantics:
   - `recordCount`
   - `fullRecordCount`
   - task-scope display names
   - full-impact display names
6. Keep carry-forward identity based on canonical `official_web:<inventory>:<version>` refs.
7. Add tests proving runtime reads grouped procedure fields from PostgreSQL typed read model, not
   only object artifacts.

## Acceptance Criteria

- Existing release tests pass.
- New release tests prove grouped procedure fields are persisted and source refs are field-specific.
- Runtime query tests can retrieve grouped procedure fields from typed read model.
- Old flat records still answer through compatibility mapping.
- Rollback/mixed-version behavior is documented and tested.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write
uv run --all-packages python -m unittest tests.ingestion.official_web_projection_core_replay_suite
go test ./internal/structuredquery ./internal/httpapi
uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core tests/ingestion
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- read-model migration shape
- compatibility behavior
- changed ingestion/runtime files
- task-scope/full-impact evidence
- verification evidence
