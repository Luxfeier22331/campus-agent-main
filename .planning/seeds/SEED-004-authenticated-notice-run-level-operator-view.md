---
id: SEED-004
status: completed
planted: 2026-05-01
planted_during: authenticated-notice-ingest-operator-panel closeout after Phase 6
trigger_when: operators need panel-visible collector-run or queue-run processing state beyond per-notice projection
scope: Medium
surfaced_as: .planning/workstreams/authenticated-notice-run-level-operator-view/README.md
completed: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# SEED-004: Authenticated Notice Run-Level Operator View

## Why This Matters

**Status:** implemented by
`.planning/workstreams/authenticated-notice-run-level-operator-view/`.

The authenticated-notice ingest operator panel workstream completed the per-notice view for both
schedule and non-schedule samples. A closeout coverage audit found no strict notice-id projection
gap: notice-scoped processing is visible for `355867` and `355650`.

The remaining unmatched local queue rows are not missing per-notice records. They are either older
attempts for the same notice or collector-run-scoped jobs such as `20260428T181953007Z`. Those jobs
answer a different operator question: what happened to a collector run or queue run as a whole?

That question should be admitted as a separate run-level operator surface rather than expanding the
per-notice projection until it mixes run truth, queue truth and notice truth.

## When to Surface

**Trigger:** operators need panel-visible collector-run or queue-run processing state beyond
per-notice projection.

This seed should be presented during `$gsd-new-milestone` when any of these conditions are true:

- operators ask why a collector run such as `20260428T181953007Z` succeeded, failed, cancelled or
  only ran source-truth import
- product scope requires a panel list/detail view for authenticated notice collector runs,
  replay batches or queue jobs
- ingestion queue rows need lifecycle visibility even when they are not scoped to a single notice id
- manual review, cancelled, retryable or failed queue attempts need operator explanation without
  attaching them to the final per-notice projection
- run-level processing needs coverage audit, historical backfill or drift detection distinct from
  per-notice projection

## Scope Estimate

**Medium** — this should reuse app-api as the browser-facing operator owner, but it needs a distinct
projection shape and UI resource from the existing per-notice processing view.

## Breadcrumbs

Related evidence and implementation artifacts:

- `.planning/workstreams/authenticated-notice-ingest-operator-panel/README.md`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/STATE.md`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-projection-coverage-audit-20260501T235219/coverage-summary.json`
- `docs/runbooks/authenticated-notice-processing-operator-panel-runbook.md`
- `apps/app-api/src/modules/authenticated-notice-processing-query`
- `apps/app-api/src/modules/authenticated-notice-processing-command`
- `apps/protected-panel-web/src/panel/authenticated-notices`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processing_projection.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/backfill_authenticated_notice_processing_projection.py`

## Notes

- Keep the existing per-notice projection focused on notice-level operator questions.
- Model run-level truth separately: collector run id, replay batch id, queue jobs, attempt outcomes,
  child task rollups and source-truth/downstream summary.
- Do not make protected-panel-web read queue tables, object storage, operations directories or raw
  telemetry directly.
- Do not expose raw notice body, HTML, OCR payloads, attachment bytes, object keys, local paths,
  credentials or stack traces.
- Do not use run-level view as permission to reopen public serving surfaces or downstream
  materialization semantics.
