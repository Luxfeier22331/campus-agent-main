---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 1
workstream: authenticated-notice-service-status-consumption
---
# Phase 1 Plan: Boundary And Selected Admission

<!-- markdownlint-disable MD013 -->

## Goal

冻结 service-status 通知消费边界，并形成第一批 selected admission cohort，作为后续
schema/materializer/release 的真实输入。

## Context To Read

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json`
- `configs/ingestion/campus_notices/internal_notice/routing-taxonomy-eval.v1.jsonl`
- `.planning/workstreams/notice-consumption-layer/README.md`
- `.planning/workstreams/notice-routing-taxonomy-and-web-card-consumption/README.md`

## Tasks

1. Build a service-status boundary matrix.
   - Include facility, classroom/self-study room, venue, IT platform, library,
     service counter, hospital/logistics window, and transport-adjacent status.
   - For each row, specify owner surface, accepted examples, rejected examples,
     and fail-close reason.
1. Audit taxonomy rules that currently route to `service_status_candidate`.
   - Confirm families and default route overrides that produce service-status
     candidates.
   - Identify families that are likely schedule, service guide, contact, or
     notice-level query.
1. Produce selected cohort criteria.
   - Minimum target: at least one case per service family.
   - Include explicit negative/boundary cases.
   - Use selected notice ids when available; otherwise produce deterministic
     fixture placeholders and mark live ids as Phase 1 blocker.
1. Draft consumer admission manifest expectations.
   - `target_surface=campus_services/service_status_candidate`
   - `operation=typed_materialization`
   - selected/upsert and replace-scope modes separated.
1. Update workstream `STATE.md` with the selected cohort and any missing
   inventory blockers.

## Expected Artifacts

- `BOUNDARY.md`
- `SELECTED-COHORT.md`
- Optional `evidence/phase-01-selected-cohort/*.json`
- Updated `STATE.md`

## Acceptance Criteria

- Boundary table clearly separates service status from regulation, schedule,
  service guide, contact directory, and notice-level query.
- First cohort is bounded, source-linked, and suitable for typed
  materialization.
- Negative cases are present; the workstream does not consume every
  service-looking notice.
- No runtime opening is claimed.

## Verification

```bash
rg -n \
  "service_status_candidate|facility_service_status|it_platform_service_status|library_service_status|transport_commute_status" \
  configs/ingestion/campus_notices/internal_notice
```

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.authenticated_notice_notice_family_classification_suite
```
