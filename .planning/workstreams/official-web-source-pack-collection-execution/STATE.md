---
workstream: official-web-source-pack-collection-execution
created: 2026-05-03
updated: 2026-05-05
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 7 closeout complete
**Last Activity:** 2026-05-05
**Last Activity Description:** Added academic calendar structured projection release evidence as a one-time curated source-truth follow-up. The `calendar/academic_calendar` read model was published to current Postgres/object storage and runtime-smoked for teaching week, holiday, and makeup-class questions.

## Progress

**Phases Complete:** 7
**Current Plan:** Workstream closed. Follow-up work moves to ingestion-owned selected-write /
release execution or one-time curated structured projections, not source-pack collection design.

## Current Slice

- Source-pack manifest contract and first-slice manifest are tracked.
- Collector accepts source-pack lineage override input and preserves pack lineage into source-truth.
- Ingestion replay composes `information_disclosure` offline from procedure/material/contact pages.
- Batch source-pack no-promotion seam exists as a dedicated script instead of looping single-target seam.
- Selected-write release task ownership remains in ingestion, not app-api.
- Source-pack seam closeout is resumable from an existing output root and writes
  `seam-report.json` deterministically from recorded artifacts.
- Source-pack seam acceptance now requires ingestion-owned selected-write release task admission
  whenever the consumer review decision is `dry_run_ready` or `partial_dry_run_ready`.
- Academic calendar is handled as one-time curated structured projection evidence, not as a
  recurring official-web collector lane.

## Open Decisions

- Whether release path should later preserve multi-page component provenance beyond current primary
  source-ref collapse.

## Session Continuity

**Stopped At:** Source-pack collection execution closed with live seam evidence and resumable
closeout.
**Resume File:** None

## Downstream Handoff

The next owner lane is ingestion-owned release execution:

- selected-write task admission is produced by
  `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- release task contract/store live in
  `packages/ingestion-core/src/campus_ingestion_core/official_web_release_task_*.py`
- selected-write execution lives in
  `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- operator-safe projection ingest/read live in
  `apps/app-api/src/modules/official-web-release-task-processing-*`

This workstream does not own current structured projection mutation or release-task runtime beyond
proving that source-pack replay can admit those tasks.

## Academic Calendar Follow-Up Evidence

Academic calendar service questions such as `今天第几教学周`, `五一放几天`, and `哪周补课`
are now covered by the structured `calendar/academic_calendar` projection.

Evidence:

- `evidence/academic-calendar-structured-release/publish-report.json`
- `evidence/academic-calendar-structured-release/release-manifest.json`
- `evidence/academic-calendar-structured-release/validation-summary.json`
- `evidence/academic-calendar-structured-release/runtime-smoke-report.json`

Result:

- release id: `academic-calendar-muc-2025-2026-20260505T100000`
- current read model: `calendar/academic_calendar`
- record count: 47
- validation: `valid=true`
- runtime smoke: passed for teaching week, holiday, and makeup-class probes

This evidence does not reopen official-web collector automation. The forward model is curated
source truth plus selected-write projection publish for calendar facts.
