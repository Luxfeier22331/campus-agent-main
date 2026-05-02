---
workstream: official-web-service-info-target-expansion
created: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Active
**Current Phase:** Phase 0 - Boundary And Field Denominator
**Last Activity:** 2026-05-02
**Last Activity Description:** Denominator and machine review gate corrected

## Progress

**Phases Complete:** 0
**Current Plan:** `.planning/workstreams/official-web-service-info-target-expansion/phases/phase-00-boundary-and-field-denominator/PLAN.md`

## Current Slice

Freeze downstream fields, target expansion boundary, machine review semantics and ownership before
adding source candidates.

## Blockers

- None for planning.

## Risks

- Source pages may not contain office hours, handling channels or material lists. Those gaps must
  become blocked candidates, not broader crawl.
- Existing denominator configs require `email` / `office_hours` for contact and service process,
  entry, material, phone, location and office hours for service guide. Phase work must either
  satisfy those fields or explicitly change tracked denominator config; prose cannot relax them.
- Existing official-web registry state is dirty in the current worktree. This workstream should not
  revert unrelated registry or implementation changes.

## Session Continuity

**Stopped At:** Phase 0 planning scaffold
**Resume File:** `.planning/workstreams/official-web-service-info-target-expansion/README.md`
