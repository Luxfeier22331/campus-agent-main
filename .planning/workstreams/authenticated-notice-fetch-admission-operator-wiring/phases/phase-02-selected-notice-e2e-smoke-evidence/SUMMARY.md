---
doc_type: summary
phase: phase-02-selected-notice-e2e-smoke-evidence
status: post-repair-validated
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Summary: Selected Notice E2E Smoke Evidence

## Completed

- Selected real notice `355867`: `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`.
- Fixed source-truth retention integration so this notice becomes `candidate_service_fact` with 3 inline image refs marked `fetch_to_quarantine`.
- Ran source-truth-only import in `plan` mode and `admit-and-materialize` mode.
- Generated fetch request manifest from source-truth inventory with `fetch_request_count=3` and `required_source_object_count=0`.
- Replayed the same selected collector bundle through the repaired attachment-flow logic without live portal access.
- Confirmed the 3 previously collected inline PNGs are preserved as `uploaded_quarantine` with `byte_fetch_required=false`.
- Confirmed the repaired fetch request manifest from replayed attachment refs has `fetch_request_count=0`.
- Confirmed multimodal readiness creates 3 `schedule_image_ocr` candidates with source object refs.
- Confirmed schedule image OCR mini-batch dry run selects 1 notice / 3 images / 0 blocked candidates.

## Evidence

- `evidence/phase-02-selected-notice-e2e-smoke/355867/selected-source-summary.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/import-plan.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/import-admit-source-truth-only.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/fetch-request-manifest.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/fetch-request-manifest.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/auth-check.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/selected-collector-export.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/post-repair-flow/phase-04-reimport-preview/searchable-notice-preview.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/post-repair-flow/phase-04-reimport-preview/fetch-request-manifest.from-preview.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/post-repair-flow/phase-05-multimodal-readiness/multimodal-candidate-inventory.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/post-repair-flow/phase-06-3-schedule-image-ocr-mini-batch/schedule-image-ocr-execution-manifest.json`

## Superseded Blocker

`pnpm --dir apps/authenticated-notice-collector auth:check` currently fails with `auth-expired: getNoticeByPage failed: session invalid`.

Selected collector export also fails before attachment fetch with `auth-expired: getNoticeSlects failed: session invalid`.

The post-repair replay does not require live portal auth and supersedes the old 3-row fetch manifest for this already collected fixture. Live auth is still needed only to prove a fresh collector run consumes an operator manifest end-to-end.

## Resume

For live collector proof, refresh authenticated portal cookies/storage state, confirm `auth:check` passes, then rerun:

```bash
AUTHENTICATED_NOTICE_COLLECTION_MODE=selected \
AUTHENTICATED_NOTICE_SELECTED_NOTICES=355867:5:办公通知 \
AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH=.planning/workstreams/authenticated-notice-fetch-admission-operator-wiring/evidence/phase-02-selected-notice-e2e-smoke/355867/fetch-request-manifest.json \
AUTHENTICATED_NOTICE_WRITE_LOCAL_EXPORTS=true \
pnpm --dir apps/authenticated-notice-collector bootstrap:export
```

For next offline validation, build a larger sampled cohort from existing captured notice bundles and assert:

- notice-discover-only attachments stay `metadata_only`.
- inline visual service facts with captured bytes become `uploaded_quarantine`.
- source-owner/admitted attachments with captured bytes become `uploaded_required`.
- fetch request manifests only include refs that still lack bytes and explicitly require fetch.
