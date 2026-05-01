---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Authenticated Notice Ingest Operator Panel

This workstream makes authenticated notice processing visible in the protected
operator panel through an `app-api` owned, operator-safe projection.

The target user question is:

> For a notice such as `355867`, what happened after collection: was it
> enqueued, consumed, OCR/admitted, materialized downstream, and made consumable
> by the schedule tool?

## Current Status

- status: `completed`
- current phase: `Phase 6 real-environment closeout completed`
- phases complete: `7 / 7 complete for implementation, selected schedule notice acceptance, non-schedule service-status acceptance and operator projection visibility`
- Phase 1, Phase 2, Phase 3, Phase 4, Phase 5 and Phase 7 implementation
  deliverables are present in current worktree.
- Phase 6 selected schedule notice smoke passed in the real local
  Postgres/object-store environment for notice `355867`.
- Phase 6 non-schedule parity passed for service-status notice `355650`
  (`关于静园10号楼负一层女浴室试运行的通知`) through the app-api internal
  processing snapshot ingest seam and operator list/detail projection.
- Post-closeout coverage audit confirmed strict per-notice projection diff is
  `0`; collector-run-level rows are covered by the separate run-processing
  projection and panel resource.
- created from observed gap after validating notice `355867`
  (`关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`) reached
  `transport_schedule_lookup` consumption.

## Problem

The repository already has durable internal processing evidence:

- `ingestion_queue.notice_ingest_jobs`
- authenticated notice run queue consume trace / failed report
- child task summaries
- source handoff canonical execution state
- typed downstream materialization reports
- structured projection current/release/read-model tables
- object-store release artifacts

But the protected panel cannot show this per-notice processing status. The panel
currently exposes request observability and official-web control-plane surfaces;
its `jobs` and `operations` routes are intentionally delayed because panel must
not directly read queue tables, operations directories, object-store artifacts,
or raw telemetry.

## Target Shape

The first release is read-only:

1. ingestion worker and/or reconciler emits sanitized authenticated-notice
   processing snapshots.
2. `apps/app-api` owns the durable operator projection and HTTP query contract.
3. protected panel consumes only `app-api` operator endpoints.
4. operators can search by notice id/title/run id and inspect lifecycle status,
   child task summaries, downstream materialization, release/read-model counts,
   serving/tool readiness, and app-api computed freshness/staleness.
5. raw notice body, HTML, OCR payloads, attachment bytes, local paths, object
   store credentials, and raw operations file paths are never exposed.

## Boundaries

- This workstream does not change collector, queue, or downstream semantics.
- This workstream does not add retry/cancel/re-enqueue buttons.
- This workstream does not let panel read ingestion Postgres tables directly.
- This workstream does not let panel read object storage or operations
  directories directly.
- This workstream does not open a new public serving surface.
- This workstream may add internal `app-api` ingest endpoints or a repo-owned
  projection drain, but the panel-facing truth remains `app-api` owned.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- future phase plans: `./phases/*/PLAN.md`
