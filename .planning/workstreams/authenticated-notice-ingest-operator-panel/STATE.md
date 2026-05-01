---
workstream: authenticated-notice-ingest-operator-panel
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 1 next
**Last Activity:** 2026-05-01
**Last Activity Description:** Created workstream and drafted detailed phase roadmap for app-api/panel authenticated notice processing visibility.

## Progress

**Phases Complete:** 0
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

## Current Gaps

- No app-api owned projection for authenticated notice processing status.
- No app-api operator endpoints for authenticated notice ingest/downstream status.
- No worker emitter or reconciler that publishes sanitized ingest status to app-api.
- No backfill path that makes existing processed notices such as `355867` visible in panel.
- No protected-panel resource/page for authenticated notice processing.
- No E2E acceptance that proves panel can answer whether a notice reached
  downstream schedule tool consumption.

## Next Slice

Start Phase 1: freeze the operator-safe projection contract and redaction rules.

## Session Continuity

**Stopped At:** Workstream planning created
**Resume File:** `.planning/workstreams/authenticated-notice-ingest-operator-panel/ROADMAP.md`
