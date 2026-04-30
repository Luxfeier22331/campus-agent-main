---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 0 Scope And Truth Alignment

## Goal

Freeze the exact scope, current code/doc truth, and acceptance denominator for the
canonical retrieval hardening workstream.

## Requirements

- Identify every opened or retrieval-ready collection.
- Identify release / replay / backup / retrieval runtime entrypoints.
- Confirm which gaps are correctness blockers versus quality/cost hardening.
- Produce a short evidence inventory under this workstream.
- Freeze online runtime manifest posture: request path reads Qdrant payload / current release
  metadata, while object-store manifest remains audit / offline fallback.
- Define the minimum acceptance case denominator required before query-serving alias publish.
- Do not change runtime behavior in Phase 0.

## Implementation Tasks

1. Inventory current scopes.
   - Read `configs/ingestion/*/*/runtime-profile.json`.
   - Compare `query_enabled_by_default`, `retrieval_enabled`, and `serving_stage`.
   - Compare with `configs/runtime/query-serving-scopes.v1.json`.

2. Inventory current chain owners.
   - `packages/ingestion-core`: preparation, release, replay, backup.
   - `packages/retrieval-core`: Qdrant backend, filters, evidence shaping.
   - `packages/rag-agent`: query planning / answer path consumption.

3. Confirm external baseline.
   - Keep external links in workstream notes only; do not let them override repo
     architecture.
   - Extract only actionable acceptance principles.

4. Produce `evidence/phase-00-current-inventory.md`.
   - List current facts.
   - List confirmed gaps.
   - List deferred/non-goal items.
   - Record the fixed phase order: provenance before runtime drift guard.
   - Record the fail-closed rule for missing query-serving acceptance cases.
   - Record the runtime metadata source decision.

5. Update `STATE.md`.
   - Set current phase evidence.
   - Mark Phase 0 completed when inventory is written and docs lint passes.

## Verification

```bash
pnpm docs:lint
```

## Done Criteria

- Workstream has a current inventory artifact.
- Phase 1 can proceed without re-litigating scope.
- No runtime code changed in Phase 0.
