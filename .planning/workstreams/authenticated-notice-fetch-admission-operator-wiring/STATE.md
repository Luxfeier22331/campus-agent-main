---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-04-30
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 5 completed
**Last Activity:** 2026-04-30
**Last Activity Description:** Added media extraction closeout lane. Schedule image OCR post-run previews and regulation owner-text execution reports now emit canonical closeout result manifests; the new dry-run closeout worker merges those results into media extraction candidate inventory and clears target-blocking for terminal candidates.

## Progress
**Phases Complete:** 5
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

Refresh live portal auth when available and run a fresh selected collector smoke to prove operator manifest consumption against a live run; offline state-machine, media-readiness, cleanup gate, and closeout lane acceptance are currently clean.

## Session Continuity
**Stopped At:** Phase 5 media extraction closeout lane complete; live collector proof remains auth-dependent
**Resume File:** None
