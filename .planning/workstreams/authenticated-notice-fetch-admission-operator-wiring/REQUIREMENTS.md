---
doc_type: requirements
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Requirements: Authenticated Notice Fetch Admission Operator Wiring

## Goals

- Provide an ingestion-worker operator CLI that builds `authenticated_notice_attachment_fetch_request_manifest_v1` from source-truth inventory and attachment refs.
- Make explicit selected-notice fetch admission reproducible without relying on collector local paths or manual JSON editing.
- Update collector and smoke runbook docs so operators understand that object storage enables handoff, not default attachment byte retention.
- Preserve the source retention state machine: notice route first, then per-attachment fetch policy, then collector byte fetch.

## Non-Goals

- No product/API scheduler or app-api control plane.
- No authenticated portal credential refresh redesign.
- No new downstream consumer admission.
- No reopening `notice-ingest-fact-state-machine`; Phase 9 remains the completed baseline.
- No migration from S3-compatible object storage semantics to local filesystem semantics.

## Success Criteria

- Operator can generate a manifest with `uv run --all-packages python -m campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`.
- Manifest includes only fetch-required policies and omits `metadata_only`.
- Explicit `--notice-id` selection fails when the source-truth inventory does not contain the requested notice.
- Collector docs name `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH` as the only notice attachment fetch admission input.
- Runbook describes the two-step operator handoff for selected collector export.
- Focused Python tests, collector config/export tests, docs lint, ruff, and diff checks pass for touched scope.
