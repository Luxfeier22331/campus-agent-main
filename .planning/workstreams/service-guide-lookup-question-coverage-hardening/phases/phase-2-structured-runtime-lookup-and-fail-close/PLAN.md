---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-2-structured-runtime-lookup-and-fail-close
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Structured Runtime Lookup And Fail-Close

## Goal

Make Go structured runtime enforce requested service-guide focus and fail closed when the requested
field is absent or unverifiable.

## Inputs To Inspect

- `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`
- `apps/supervisor-api/internal/structuredquery/service_guide_matching.go`
- `apps/supervisor-api/internal/structuredquery/service_guide_response.go`
- `apps/supervisor-api/internal/structuredquery/runtime_fixtures_test.go`
- `QUESTION-MATRIX.md`

## Tasks

1. Reuse existing runtime fixtures where the matrix marks `existing_runtime_fixture`.
2. Add synthetic runtime fixtures only for rows marked `synthetic_runtime_fixture`.
3. Add positive runtime tests for each focus class.
4. Add fail-close runtime tests for each missing requested field.
5. Confirm `entry_refs.url` is selected for user-facing entry answers and `source_refs` remain
   provenance only.
6. Update runtime implementation only where tests reveal current behavior drift.
7. Update `MATRIX-COVERAGE-AUDIT.md` runtime rows.
8. Update `STATE.md` with Phase 2 evidence.

## Exit Criteria

- Runtime never substitutes unrelated guide content for a missing requested focus.
- Runtime never treats provenance `source_refs` as service entry URLs.
- Runtime keeps `full_guide` available only for broad questions.
- Synthetic fixture rows are documented as behavioral tests, not source-truth admission.

## Completion Evidence

- Added runtime coverage for missing requested fields across entry, contact, office-hours and
  required-materials focus paths.
- Verified entry URL questions use `entry_refs.url` and fail closed when only provenance refs exist.
- Verified grouped procedure lookup selects the requested procedure group without dumping unrelated
  guide sections.
- Verified campus-card entry/contact and academic-calendar entry URL rows resolve through the typed
  read model.

## Verification

```bash
cd apps/supervisor-api && go test -count=1 ./internal/structuredquery -run 'ServiceGuide'
git diff --check -- apps/supervisor-api/internal/structuredquery .planning/workstreams/service-guide-lookup-question-coverage-hardening
```
