---
doc_type: plan
status: completed
created: 2026-04-27
updated: 2026-04-27
phase: Phase 10
workstream: notice-consumption-layer
---

<!-- markdownlint-disable MD013 -->

# Phase 10 Plan: Campus Services Typed Candidate Admission Hardening

## Objective

Apply the Phase 9 admission boundary to all notice-derived campus-services typed
materializers and add a minimal stable-contact candidate artifact path.

## Deliverables

1. `service_status` worker manifest gate
2. `service_guide` worker manifest gate
3. notice-only service-guide release guard
4. notice-derived stable-contact candidate core builder
5. stable-contact candidate worker CLI with manifest gate
6. build-report admission observability fields
7. deterministic unit tests for new gates and candidate path

## Acceptance

- `service_status` typed materialization requires manifest and fails closed on gate block.
- `service_guide` typed materialization requires manifest and fails closed on gate block.
- notice-only service-guide release requires explicit `--allow-notice-derived-only-release`.
- stable-contact candidate worker requires manifest and selection.
- all new/changed tests pass without live dependencies.
