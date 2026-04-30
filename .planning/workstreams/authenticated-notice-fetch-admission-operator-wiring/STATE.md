---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-04-30
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 7 completed; Phase 8 next
**Last Activity:** 2026-04-30
**Last Activity Description:** Hardened the media extraction state machine contract. Fact readiness now admits target multimodal only from explicit `target_blocking` candidates, media lifecycle uses canonical `pending` / `completed` / `skipped` / `manual_review` / `failed_retryable` / `failed_terminal` states, closeout preserves result manifest provenance, and attachment fetch admission now treats stale object refs without upload state as bytes-missing.

## Progress

**Phases Complete:** 7
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

Run captured-content smoke against already collected authenticated notice content.
This is higher priority than fresh selected collector smoke because it validates
the state machine we just changed: notice routing, fetch omission, media
readiness, fact readiness, closeout, cleanup gate, and downstream admission over
existing source-truth/searchable replay evidence.

Fresh selected collector export remains a secondary auth-dependent
manifest-consumption proof; it should not block captured-content state-machine
acceptance.

## Phase 6 Result

- Rebuilt current-code media extraction readiness for selected notice `355867`; output contains 3 `schedule_image_ocr` candidates with `target_blocking=true`.
- Schedule OCR post-run preview from captured OCR outputs extracted 32 transport schedule rows and emitted `notice_media_extraction_closeout_result_manifest.v1`.
- OCR closeout result after Phase 7 normalization: 2 candidates `completed`, 1
  candidate `manual_review` with low confidence; the non-terminal candidate
  remains target-blocking.
- Cleanup dry-run with pending inventory blocks all 3 quarantine objects.
- Cleanup dry-run after OCR post-run closeout releases 2 quarantine objects and blocks the low-confidence image.
- Manual terminal override marks the low-confidence image `failed_terminal`; cleanup dry-run then releases all 3 quarantine objects.

## Session Continuity

**Stopped At:** Phase 7 state-machine contract hardening complete; Phase 8 captured-content smoke should run next
**Resume File:** None

## Phase 7 Result

- Removed whole-unit `media_text_status=pending` / `multimodal_status=pending`
  fallback from target admission when no explicit blocking candidate exists.
- Canonicalized contract-facing media lifecycle states to `pending`,
  `completed`, `skipped`, `manual_review`, `failed_retryable`, and
  `failed_terminal`.
- Preserved closeout result manifest provenance on updated candidates.
- Added fail-fast validation for candidate inventory `candidate_id`, `status`,
  `target_blocking`, and required source object refs for blocking candidates.
- Unified attachment bytes availability with source retention: object key and
  hash alone are insufficient without non-reference storage provider and
  uploaded/downloaded ingest state.
