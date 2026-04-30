---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-04-30
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 6 completed
**Last Activity:** 2026-04-30
**Last Activity Description:** Ran offline closeout verification for selected notice `355867`. Current-code readiness produced 3 target-blocking `schedule_image_ocr` candidates; OCR post-run closeout terminalized 2 and preserved 1 low-confidence image as blocking; a manual terminal override then cleared the final blocker and allowed quarantine cleanup dry-run to release all 3 candidate objects.

## Progress

**Phases Complete:** 6
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

Refresh live portal auth when available and run a fresh selected collector smoke to prove operator manifest consumption against a live run; offline state-machine, media-readiness, closeout lane, and cleanup gate acceptance are currently clean.

## Phase 6 Result

- Rebuilt current-code media extraction readiness for selected notice `355867`; output contains 3 `schedule_image_ocr` candidates with `target_blocking=true`.
- Schedule OCR post-run preview from captured OCR outputs extracted 32 transport schedule rows and emitted `notice_media_extraction_closeout_result_manifest.v1`.
- OCR closeout result: 2 candidates `completed`, 1 candidate `failed` with `low_confidence`; the failed non-terminal candidate remains target-blocking.
- Cleanup dry-run with pending inventory blocks all 3 quarantine objects.
- Cleanup dry-run after OCR post-run closeout releases 2 quarantine objects and blocks the low-confidence image.
- Manual terminal override marks the low-confidence image `failed_terminal`; cleanup dry-run then releases all 3 quarantine objects.

## Session Continuity

**Stopped At:** Phase 6 offline closeout verification complete; live collector proof remains auth-dependent
**Resume File:** None
