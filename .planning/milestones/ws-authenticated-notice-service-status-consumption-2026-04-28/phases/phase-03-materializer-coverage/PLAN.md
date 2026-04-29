---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 3
workstream: authenticated-notice-service-status-consumption
---
# Phase 3 Plan: Materializer Coverage

<!-- markdownlint-disable MD013 -->

## Goal

扩展 notice-derived service status materializer，使它可以从 admitted candidates 生成真实
typed service status records，而不是只覆盖交通乘车点窄样本。

## Tasks

1. Split materializer by service family.
   - facility / classroom / self-study room / venue
   - IT platform / portal / OA / identity / network / card platform
   - library open/close/area availability
   - service counter / hospital / logistics window
   - transport-adjacent status only when not owned by schedule
1. Implement subject identity normalization.
   - Stable `subject_id` conventions.
   - Alias extraction from title/body.
   - Campus/location/platform references where available.
1. Implement temporal extraction.
   - Full date-time windows.
   - Yearless date resolution from source notice release time.
   - Holiday/semester wording only when deterministic; otherwise reject.
1. Implement status extraction.
   - `open`, `closed`, `temporarily_closed`, `limited_service`, `unknown`.
   - Convert maintenance, suspension, recovery, open-hour changes into
     normalized status.
1. Produce rejected-source records.
   - Missing subject, missing effective window, non-status action notice,
     schedule-owned fact, service-guide-owned fact, source conflict.
1. Preserve selected admission gate.
   - Materializer only consumes entries admitted through consumer admission
     manifest.

## Expected Artifacts

- Updated `notice_derived_service_status_materialization.py`
- Updated `test_notice_derived_service_status_materialization.py`
- New fixtures for each service family

## Acceptance Criteria

- Each Phase 1 selected family can produce at least one valid service status
  record.
- Boundary/negative examples are rejected with deterministic reasons.
- Materializer does not silently promote notice-level query or service-guide
  notices.
- Existing transport boarding-point behavior remains either covered here or
  explicitly moved under schedule-owned transport operational truth.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization
```
