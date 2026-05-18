---
workstream: official-web-source-pack-collection-execution
created: 2026-05-03
updated: 2026-05-06
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 7 closeout complete
**Last Activity:** 2026-05-06
**Last Activity Description:** Refreshed the expanded `official-web-public-regulation-closeout.v1` one-time closeout with the patched collector classifier: fresh seam replay captured `40` retained source-truth pages, `1107` now classified as `article_detail`, and closeout materialization now yields `23` regulation documents with docs reader assets into `regulations/institutional_rules` and `regulations/student_rules`.

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
- Public regulation expansion now has downstream materialization evidence:
  - one-time source-pack replay -> regulation canonical documents
  - reader asset manifest generation for public docs consumption
  - no broad crawl reopening
  - obvious non-rule material fragments suppressed before candidate materialization
  - skipped source-pack preview regulation pages no longer fall back into
    `official_web/muc_public_pages` documents
- Public regulation closeout expansion now has full end-to-end one-time evidence:
  - `official-web-public-regulation-closeout.v1` live seam succeeded
  - explicit seed pages and same-host listing expansions were both captured
  - `40` retained source-truth pages were replayed
  - `23` regulation documents were materialized
  - docs read-model manifest/assets were generated for all `23` documents

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

For public regulations, the next owner lane is no longer source-pack collection:

- canonical documents and reader assets are now evidenced
- remaining downstream work belongs to:
  - `document-site` import/deploy if these `23` documents should be published into the live docs site
  - `regulation-rag-release-lane` only if this batch is explicitly admitted into retrieval/index
    release

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

## Public Regulation Materialization Evidence

Evidence:

- `evidence/public-regulation-materialization-proof-20260506/official-web-regulation-materialization-summary.json`
- `evidence/public-regulation-materialization-proof-20260506/materialization-report.json`
- `evidence/public-regulation-materialization-proof-20260506/docs-read-model-manifest.json`

Result:

- source-pack: `official-web-regulation-expansion.v1`
- materialized documents: `8`
- scope split:
  - `regulations/institutional_rules = 7`
  - `regulations/student_rules = 1`
- docs reader assets: `public_entry_count=8`
- filtered out as non-rule fragment:
  - `https://xxgk.muc.edu.cn/info/1290/5771.htm`
- skipped regulation preview fallback:
  - `projection-report.json` now has `emitted_documents=0`, so attachment-only or
    rejected regulation preview pages do not publish ordinary `muc_public_pages`
    documents.

## Public Regulation Closeout Evidence

Evidence:

- `var/official-web-source-pack-live-seam/owrun_source_pack_live_20260506T070213Z/seam-report.json`
- `var/official-web-source-pack-live-seam/owrun_source_pack_live_20260506T092515Z/seam-report.json`
- `evidence/public-regulation-closeout-20260506/official-web-regulation-materialization-summary.json`
- `evidence/public-regulation-closeout-20260506/materialization-report.json`
- `evidence/public-regulation-closeout-20260506/docs-read-model-manifest.json`

Result:

- source-pack: `official-web-public-regulation-closeout.v1`
- retained source-truth pages: `40`
- consumer family split:
  - `regulation_candidate = 23`
  - `student_regulation_candidate = 17`
- materialized documents: `23`
- scope split:
  - `regulations/institutional_rules = 17`
  - `regulations/student_rules = 6`
- docs reader assets:
  - `document_count = 23`
  - `public_entry_count = 23`
- the closeout batch now covers:
  - direct institutional regulation references
  - direct student/public rule references
  - same-host listing expansion details from `gzzd` / `rszd` / `jwgl` / `xszz` / `xwsy` / `jlycf`
  - post-fix `1107 -> 中央民族大学信息公开实施细则`
- downstream consumption hardening is also complete:
  - shared manifest-driven docs grouping for the `23` planned public regulation docs
  - `public-docs` real-docs landing split into `student` / `public-service` / `staff-governance`
  - published-reader `institutional_rules` index/sidebar grouped by the same manifest
  - `regulations/institutional_rules` default retrieval narrowed to `public_service` docs unless
    governance-specific query terms or explicit governance titles are present
  - repo-tracked overlap/version ledger added for handbook-vs-official-web planning
  - next one-time expansion split into:
    - HTML-direct `net_new` student/public regulations
    - download-reference follow-up rows pending shared file-asset admission
