---
workstream: authenticated-notice-ingest-operator-panel
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 6 real-environment closeout
**Last Activity:** 2026-05-01
**Last Activity Description:** Ran real Postgres/object-store selected-notice smoke for notice `355867` through queue consume, downstream materialization, app-api processing projection, and app-api operator detail query.

## Progress

**Phases Complete:** 6 / 7 complete for implementation and selected schedule notice acceptance; non-schedule real sample and final repository gates remain
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
- Phase 7: freshness/staleness policy, panel display, smoke blocked/failure
  evidence, and operator runbook.

## Remaining Gaps

- Phase 6 still needs at least one non-schedule authenticated notice real sample
  if strict roadmap parity is required.
- The real-environment attempt exposed and fixed the runbook/CLI gap for
  generating current-schema consumer admission manifests from verified collector
  runs. Legacy `entries` manifests are incompatible with the current consumer.
- Local app-api migration ledger is drifted for pre-existing
  `official_web.run_admission_decisions`; projection tables were created with
  the canonical `0027` SQL for this acceptance run, but the local ledger drift
  should be reconciled before using `pnpm --dir apps/app-api db:migrate` as a
  clean local gate.
- Repository-wide lint/typecheck/build gates still need final execution before
  commit/merge.

## Next Slice

Finish the remaining Phase 6 closeout slice: run or select a non-schedule real
notice acceptance sample, then run final targeted and repository gates.

Current selected-notice evidence:

- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/authenticated-notice-ingest-queue-e2e-smoke.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/app-api-processing-355867.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/consumer-admission-manifest.cli.json`

## Session Continuity

**Stopped At:** Selected schedule notice acceptance passed; non-schedule sample and final gates pending
**Resume File:** `.planning/workstreams/authenticated-notice-ingest-operator-panel/ROADMAP.md`
