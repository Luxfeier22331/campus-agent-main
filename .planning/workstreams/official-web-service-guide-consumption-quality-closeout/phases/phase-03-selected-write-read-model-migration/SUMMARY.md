---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 3 Summary: Selected-Write Read-Model Migration

## Delivered

- `service_guide` selected-write release now has an explicit PostgreSQL typed read-model projection
  for the runtime-consumed fields:
  - `guide_sections`
  - `procedure_groups`
  - `materials`
  - `entry_refs`
  - `office_hours`
  - `contact_refs`
  - `eligibility_notes`
  - `field_status`
- `field_status` is persisted as a JSON object column shape, while list-like fields remain JSON
  arrays or text arrays as appropriate.
- selected-write release tests now prove grouped procedure data is passed through to the PG
  publisher bundle.
- Go runtime tests now prove grouped procedure answers still resolve through the PostgreSQL
  current-release path, not only through file/object fixtures.

## Mixed-Version Compatibility

The compatibility rule for this migration is:

- canonical serving truth remains the `record` JSON payload stored in
  `ingestion_projection.service_guide_read_model`
- typed columns are explicit read-model projection columns; they do not replace canonical `record`
  semantics
- old flat-only records are accepted as long as their `record` JSON remains valid for the existing
  runtime contract
- records that do not carry `procedure_groups` or `field_status` are still publishable
- for old flat-only records:
  - `procedure_groups` typed column defaults to empty/absent semantics
  - `field_status` typed column defaults to empty-object/absent semantics
  - runtime continues to answer through `guide_sections.procedure` compatibility behavior
- for new grouped records:
  - `procedure_groups` is canonical procedure truth
  - runtime prefers focused grouped-procedure selection when present

## Rollback Semantics

Rollback does not require a historical backfill before publication because:

- runtime reads `record` JSON rather than reconstructing service-guide records from typed columns
- widening the typed column set does not invalidate older rows; missing fields fall back to the
  pre-existing flat compatibility path
- mixed old/new releases remain queryable through the same Go structured-query runtime

## Changed Files

- `packages/ingestion-core/src/campus_ingestion_core/structured_projection_postgres.py`
- `tests/ingestion/test_structured_projection_postgres.py`
- `tests/ingestion/test_release_official_web_selected_write.py`
- `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`
- `.planning/workstreams/official-web-service-guide-consumption-quality-closeout/STATE.md`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_structured_projection_postgres tests.ingestion.test_release_official_web_selected_write -q
cd apps/supervisor-api && go test ./internal/structuredquery
```
