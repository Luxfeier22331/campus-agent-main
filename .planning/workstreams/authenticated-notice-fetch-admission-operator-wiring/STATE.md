---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-05-05
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Completed
**Current Phase:** Phase 8 completed
**Last Activity:** 2026-05-05
**Last Activity Description:** Completed captured-content smoke against already collected authenticated notice content. Current-code replay produced 338 source-truth candidates/searchable units, recomputed 0 fetch requests from current refs, rebuilt 60 target media candidates, verified all 60 source objects, replayed transport/service-status/regulation downstream admission by title, applied available OCR/manual terminal closeout evidence, and passed both state-machine audits with 0 findings.

## Progress

**Phases Complete:** 8
**Current Plan:** Workstream closed. Fresh selected collector smoke remains an auth-dependent manifest-consumption proof, not a blocker for the captured-content state-machine acceptance.

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

## Phase 8 Result

- Reimport preview replayed 58 captured runs into 338 source-truth candidates
  and 338 searchable units; 18 invalid captures remain deferred by collector-run
  verification state and no searchable unit is missing.
- Fetch request recompute over 282 current notice refs produced 0 fetch requests
  and 0 required source-object fetches.
- Media readiness rebuilt 60 pending candidates: 56 released-file PDFs for
  owner-text extraction and 4 schedule images for OCR.
- Live source-object verification checked all 60 media source objects and
  verified all 60.
- Downstream admission by title:
  - transport schedule: 4 entries, 2 admitted, 2 `needs_multimodal`.
  - service status: 3 entries, 1 admitted, 2 deferred.
  - regulation: 42 entries, all `needs_multimodal` pending owner-document text.
- Known selected examples route correctly:
  - `355867` remains target-blocking from 3 schedule-image OCR candidates until
    closeout; OCR closeout completes 2 images and maps the low-confidence image
    to `manual_review`.
  - manual terminal closeout maps the low-confidence `355867` image to
    `failed_terminal`.
  - `355122` still has 1 target-blocking schedule image after available
    closeout evidence.
  - text-complete transport notices `355512` and `355881` admit from body facts.
- Cleanup dry-run blocks 4 quarantine refs while pending, releases 2 after OCR
  closeout, and releases 3 after manual terminal closeout.
- State-machine audit and media-closeout audit both passed with 0 findings.

Evidence:

- `evidence/phase-08-captured-content-smoke/captured-content-smoke-summary.json`
- `evidence/phase-08-captured-content-smoke/media-closeout-state-machine-audit-current.stdout.json`
- `evidence/phase-08-captured-content-smoke/state-machine-audit-current/state-machine-audit.json`
- `evidence/phase-08-captured-content-smoke/source-object-verification/media-source-object-verification-report.json`

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

**Stopped At:** Workstream closed after Phase 8 captured-content state-machine acceptance.
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
