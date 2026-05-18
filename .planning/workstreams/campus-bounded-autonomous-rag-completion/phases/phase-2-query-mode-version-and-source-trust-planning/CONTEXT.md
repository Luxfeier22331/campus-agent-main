---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Context: Query Mode, Version, And Source-Trust Planning

## Goal

Make query mode, version and source-trust eligibility explicit before retrieval execution.

## Starting Truth

- Current accepted modes include `current`, `historical`, `as_of` and `compare`.
- `freshness_sensitive` and `live_assisted` remain target/deferred branches, not default product
  openings.
- Source trust and serving eligibility are owned by runtime profile, release manifest, current
  pointer and authz projection.

## Required Decisions

- How planner output records mode, version, source-trust requirements and freshness posture.
- How mode/source mismatch is surfaced to synthesis and final response.
- How no-answer differs from clarification for missing time/version/source context.

## Out Of Scope

- Opening live source lookup.
- Changing release manifest ownership.
- Treating source freshness as query-time broad crawl.
