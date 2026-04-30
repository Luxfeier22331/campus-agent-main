---
workstream: authenticated-notice-fetch-admission-operator-wiring
created: 2026-04-30
updated: 2026-04-30
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 1
**Last Activity:** 2026-04-30
**Last Activity Description:** Added operator manifest builder implementation, focused tests, collector README/runbook updates, and native planning docs.

## Progress
**Phases Complete:** 1
**Current Plan:** `ROADMAP.md`

## Phase 1 Result

- Added `campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`.
- Added console script `campus-ingestion-build-authenticated-notice-attachment-fetch-request-manifest`.
- Added package lazy export `build_authenticated_notice_attachment_fetch_request_manifest_main`.
- Added tests for selected source-truth manifest generation, metadata-only omission, required/admitted owner admission rows, and selected notice missing fail-closed behavior.
- Updated collector README and bootstrap smoke runbook to reflect default reference-only attachment behavior.

## Next Slice

Phase 2 should use a real selected notice from current source-truth inventory to generate the manifest and run selected collector export with `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`.

## Session Continuity
**Stopped At:** Phase 1 implementation complete; verification pending in current session
**Resume File:** None
