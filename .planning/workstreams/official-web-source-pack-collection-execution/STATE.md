---
workstream: official-web-source-pack-collection-execution
created: 2026-05-03
updated: 2026-05-03
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 7 closeout complete
**Last Activity:** 2026-05-03
**Last Activity Description:** Closed the real source-pack live seam with resumable closeout and
ingestion-owned selected-write release-task admission evidence.

## Progress

**Phases Complete:** 7
**Current Plan:** Workstream closed. Follow-up work moves to ingestion-owned selected-write /
release execution, not source-pack collection design.

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
