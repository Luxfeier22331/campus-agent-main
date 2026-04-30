---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-04-30
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 2 post-repair validated
**Last Activity:** 2026-04-30
**Last Activity Description:** Replayed selected notice `355867` from local collector evidence after attachment-flow repair; existing inline image bytes are retained as 3 `uploaded_quarantine` refs, fetch request manifest is empty, and downstream multimodal/schedule OCR preview selects all 3 images.

## Progress
**Phases Complete:** 1
**Current Plan:** `ROADMAP.md`

## Phase 1 Result

- Added `campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`.
- Added console script `campus-ingestion-build-authenticated-notice-attachment-fetch-request-manifest`.
- Added package lazy export `build_authenticated_notice_attachment_fetch_request_manifest_main`.
- Added tests for selected source-truth manifest generation, metadata-only omission, required/admitted owner admission rows, and selected notice missing fail-closed behavior.
- Updated collector README and bootstrap smoke runbook to reflect default reference-only attachment behavior.

## Phase 2 Progress

- Real selected notice fixture: `355867` / `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`.
- Source-truth generation now marks the notice as `candidate_service_fact` with 3 `fetch_to_quarantine` inline image refs because the body references bus/shuttle schedules but has no concrete departure times.
- Source-truth-only admit/materialize succeeded and created `notice:muc_internal_portal:355867`.
- Fetch request manifest generation succeeded with `fetch_request_count=3` and `required_source_object_count=0`.
- Auth preflight failed with `auth-expired: getNoticeByPage failed: session invalid`.
- Selected collector export failed for the same auth reason before attachment fetch could run.
- Post-repair local replay from the already captured collector bundle now produces 3 `uploaded_quarantine` refs with `byte_fetch_required=false`.
- Post-repair fetch request manifest generated from replayed source-truth attachment refs has `fetch_request_count=0`.
- Multimodal readiness produces 3 `schedule_image_ocr` candidates with object refs.
- Schedule image OCR mini-batch manifest selects 1 notice / 3 images / 0 blocked candidates.

## Next Slice

Use the post-repair evidence to validate a larger sampled notice cohort, focusing on service-fact notices with inline images, ordinary notice-discover-only notices, and source-owner attachments.

## Session Continuity
**Stopped At:** Phase 2 selected fixture validated through reimport preview, fetch omission, multimodal readiness, and schedule OCR mini-batch dry run
**Resume File:** None
