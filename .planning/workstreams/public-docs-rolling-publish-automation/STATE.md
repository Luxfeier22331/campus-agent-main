---
workstream: public-docs-rolling-publish-automation
created: 2026-04-29
updated: 2026-04-29
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 2
**Current Phase Name:** Scheduled Runner And Single-flight Lock
**Current Plan:** .planning/workstreams/public-docs-rolling-publish-automation/phases/phase-2-scheduled-runner-and-single-flight-lock/PLAN.md
**Total Phases:** 6
**Total Plans in Phase:** 1
**Progress:** 1/6 phases complete
**Last Activity:** 2026-04-29
**Last Activity Description:** Started Phase 2 and planned scheduled runner +
single-flight lock implementation.

## Current Slice

- Phase 2 is planned and entering implementation.
- Scope is release orchestration for `apps/public-docs`, not docs shell /
  reader UI.
- Prod schedule target is Shanghai time `00:00 / 06:00 / 12:00 / 18:00`,
  expressed as UTC cron `0 4,10,16,22 * * *`.
- Ingest side owns manifest generation and publication.
- Deployment automation consumes current manifest pointer and immutable
  manifest assets; it does not scan object storage to decide public subset.
- Deploy execution belongs in CI / controlled runner / operator machine, not in
  Worker runtime.

## Blockers

- No active blocker for planning.
- No active blocker for Phase 2 local implementation.

## Verification

- Phase 1 evidence:
  `.planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-1-manifest-check-and-release-ledger/verification.md`
- Targeted tests and typecheck passed for `public-docs`.

## Progress

**Phases Complete:** 1
**Current Plan:** .planning/workstreams/public-docs-rolling-publish-automation/phases/phase-2-scheduled-runner-and-single-flight-lock/PLAN.md

## Session Continuity

**Stopped At:** Phase 2 planned; implementation in progress.
**Resume File:** .planning/workstreams/public-docs-rolling-publish-automation/README.md
