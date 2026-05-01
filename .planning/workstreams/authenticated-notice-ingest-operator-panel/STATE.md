---
workstream: authenticated-notice-ingest-operator-panel
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Completed
**Current Phase:** Phase 6 real-environment closeout completed
**Last Activity:** 2026-05-01
**Last Activity Description:** Added non-schedule service-status notice `355650` to the app-api operator-safe processing projection and verified operator list/detail readback alongside the existing `355867` schedule sample.

## Progress

**Phases Complete:** 7 / 7 complete for implementation, selected schedule notice acceptance, non-schedule service-status acceptance and operator projection visibility
**Current Plan:** `ROADMAP.md`

## Context

This workstream was opened after validating that notice `355867`
(`关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`) entered the
`transport_schedule_lookup` consumption path, while protected panel still had no
operator-safe view for collection/queue/ingest/downstream processing status.

Internal evidence already exists in queue rows, consumer traces, child task
summaries, typed materialization reports, structured projection releases, and
read-model tables. The missing product capability is an `app-api` owned,
operator-safe projection and protected-panel surface.

## Completed In Current Worktree

- Phase 1: HTTP contract and redaction model for app-api owned operator-safe
  processing projection.
- Phase 2: app-api schema/store/query/route path for processing snapshot ingest
  and operator list/detail.
- Phase 3: ingestion projection builder/reporter seam from authenticated notice
  queue consumer.
- Phase 4: historical projection backfill/reconciliation from retained queue
  record payloads and consume traces without queue/source mutation.
- Phase 5: protected-panel worker proxy, data-provider resource, menu entry,
  list page and detail page.
- Phase 6 selected transport schedule notice acceptance: real Postgres/object-store
  smoke for notice `355867` passed with queue `succeeded`, downstream
  materialization `completed`, processing projection `reported`,
  `candidateKind=transport_schedule`, `targetSurface=campus_services`,
  `toolReady=true`, `scheduledDepartures=49`, and `rejectedSources=0`.
- Phase 6 non-schedule authenticated notice acceptance: service-status notice
  `355650` passed through app-api internal processing snapshot ingest and
  operator list/detail readback with `queueStatus=succeeded`,
  `lifecycleStatus=tool_ready`, `candidateKind=service_status`,
  `targetSurface=campus_services`, `toolReady=true`,
  `serviceStatusRecords=1`, and `rejectedSources=0`.
- Phase 7: freshness/staleness policy, panel display, smoke blocked/failure
  evidence, and operator runbook.
- Post-closeout projection coverage audit: strict notice-id diff is `0`.
  Remaining unmatched queue jobs are older attempts for `355867` or
  collector-run-scoped rows such as `20260428T181953007Z`, which are covered by
  a separate run-processing projection rather than per-notice projection rows.

## Remaining Gaps

- The real-environment attempt exposed and fixed the runbook/CLI gap for
  generating current-schema consumer admission manifests from verified collector
  runs. Legacy `entries` manifests are incompatible with the current consumer.
- Local app-api migration ledger is drifted for pre-existing
  `official_web.run_admission_decisions`; projection tables were created with
  the canonical `0027` SQL for this acceptance run, but the local ledger drift
  should be reconciled before using `pnpm --dir apps/app-api db:migrate` as a
  clean local gate.
- Repository-wide lint/build gates remain outside this closeout because the
  current worktree also contains unrelated official-web dirty files.
- Run-level collector/queue visibility is implemented as
  `authenticated_notice_run_processing_projection` plus the protected-panel
  run-processing resource; it remains separate from the per-notice projection.

## Next Slice

No next implementation slice remains for this workstream. Future work should
only reopen it if the app-api owned authenticated-notice processing projection,
protected-panel read path, or schedule/non-schedule acceptance evidence drifts.

Current selected-notice evidence:

- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/authenticated-notice-ingest-queue-e2e-smoke.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/app-api-processing-355867.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/consumer-admission-manifest.cli.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/acceptance-summary.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/app-api-processing-355650.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/app-api-processing-list-service-status.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-projection-coverage-audit-20260501T235219/coverage-summary.json`

## Session Continuity

**Stopped At:** Workstream closeout completed; lint/commit intentionally excluded from this closeout
**Resume File:** `.planning/workstreams/authenticated-notice-ingest-operator-panel/ROADMAP.md`
