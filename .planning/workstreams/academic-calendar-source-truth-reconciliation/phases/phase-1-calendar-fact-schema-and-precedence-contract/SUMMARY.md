---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 1 Summary: Calendar Fact Schema And Precedence Contract

## Completed

Phase 1 established the projection-level contract needed for reconciled
academic calendar facts.

Implemented contract fields:

- `source_family`
- `source_precedence`
- `source_notice_ids`
- `precedence_reason`
- `conflict_refs`
- `event_alias_types`

Implemented accepted record families:

- `teaching_week`
- `named_event`
- `term_window`
- `class_day_override`
- `course_suspension`
- `normal_rest_day`
- `workday_makeup`

Implemented validation rules:

- all records must carry source family and precedence
- notice-derived records must carry `source_notice_ids`
- event-like records must carry event/source display fields
- `春假` alias must explicitly be typed as `colloquial`
- `normal_rest_day` vs makeup/workday conflicts require precedence explanation
- `course_suspension` vs baseline teaching-week conflicts require precedence
  explanation

The Go structured-query record shape was extended to accept the new projection
fields, without changing runtime resolution behavior in this phase.

## Evidence

Focused verification passed:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_academic_calendar_projection \
  tests.test_publish_academic_calendar_projection -q
```

Result: `Ran 12 tests ... OK`

```bash
cd apps/supervisor-api
go test -count=1 ./internal/structuredquery
```

Result: `ok`

## Files Touched

- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `tests/ingestion/test_academic_calendar_projection.py`
- `apps/supervisor-api/internal/structuredquery/academic_calendar_types.go`

## Deferred

Phase 1 did not admit real notice-derived source artifacts and did not resolve
`2026-05-09` yet. That remains Phase 2 and Phase 3.

Phase 0 has since been completed as a standalone audit. Its summary provides
the durable evidence matrix required before Phase 2 source artifact admission.
