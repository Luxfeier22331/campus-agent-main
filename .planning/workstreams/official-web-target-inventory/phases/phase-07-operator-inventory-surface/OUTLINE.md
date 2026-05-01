---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Outline: Operator Inventory Surface

## Goal

Ensure operators can inspect target inventory state through the existing protected-panel -> app-api
boundary.

## Planned Deliverables

- App-api read model or projection for inventory entries, latest preview, blocker state and source
  refs.
- Protected panel view or extension that shows target readiness and review status.
- Tests proving panel does not read object storage, local artifacts or ingestion-worker internals.

## Planned Checks

- Operator surface is read-only unless a separate release action is admitted.
- All displayed evidence is app-api projected and operator-safe.
- Missing preview or field blockers are visible without reading raw artifacts directly.
