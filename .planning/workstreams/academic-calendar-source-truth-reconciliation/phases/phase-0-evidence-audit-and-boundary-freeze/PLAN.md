---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 0 Plan: Evidence Audit And Boundary Freeze

## Goal

Produce a source-backed audit for the 2026 late-April / early-May calendar
arrangement and freeze the implementation boundary before schema or code
changes.

## Inputs

- `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/central-minzu-2025-2026.v1.json`
- `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260425T122117.555Z.json`
- `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260427T020248.597Z.json`
- `apps/supervisor-api/internal/structuredquery/academic_calendar.go`
- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `configs/ingestion/calendar/academic_calendar/README.md`

## Tasks

1. Extract baseline calendar records covering `2026-04-25` to `2026-05-09`.
2. Extract notice `355589` official title, source URL, release time and body facts.
3. Extract notice `355682` official title, source URL, release time and body facts.
4. Search captured notices for `春季社会实践周` and decide whether any additional
   notice should be admitted as direct evidence in this workstream.
5. Build an evidence matrix:
   - date / range
   - baseline calendar fact
   - notice-derived fact
   - conflict or supplement
   - proposed precedence
   - source refs
6. Freeze boundary decisions:
   - `春假` remains colloquial, not official event name
   - runtime remains projection-backed only
   - notice original lookup remains notice tool responsibility
   - source-truth reconciliation belongs to data-plane/projection, not agent prompt
7. Write `SUMMARY.md` in this phase directory.

## Acceptance

- `SUMMARY.md` cites all source file paths and notice ids.
- The `2026-05-09` conflict is explicitly documented.
- The official composite wording for student `春假` is explicitly documented.
- Phase 1 schema decisions are unblocked.

## Verification

```bash
pnpm docs:lint
```
