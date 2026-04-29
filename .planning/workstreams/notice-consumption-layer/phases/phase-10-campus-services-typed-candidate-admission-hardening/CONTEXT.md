---
doc_type: context
status: completed
created: 2026-04-27
updated: 2026-04-27
---

<!-- markdownlint-disable MD013 -->

# Phase 10 Context: Campus Services Typed Candidate Admission Hardening

## Trigger

Phase 9 introduced manifest and release gates for import/projection/read-model paths, but
notice-derived campus-services materializers were still able to run without the same
typed-target admission boundary.

## Current Facts

- `build_service_status_projection` can consume selected notice projection rows.
- `build_service_guide_projection` can consume selected special-service candidates.
- `campus_services/contact_directory` did not have a notice-derived stable-contact candidate
  builder path.
- consumer admission gate already supports `typed_materialization` and target-surface checks.

## Goal

Make notice-derived campus-services typed materialization fail closed behind
consumer admission manifest and typed target-surface gate.

## Non-Goals

- No live portal collection.
- No historical full backfill.
- No production PG/object-store smoke.
- No transaction runtime opening.
- No direct publication of notice contact candidates as stable contact directory truth.
