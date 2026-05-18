---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Contract Package And Store Plan

## Result

Phase 1 is complete.

The workstream now has an implementation-ready `CONTRACT-STORE-PLAN.md` that specifies:

- exact `packages/ingestion-core` module paths
- canonical model responsibilities
- forbidden payload rules
- `SourceHandoffStore` protocol shape
- Python-owned `ingestion_control` Postgres logical schema
- official-web compatibility projection
- authenticated-notice compatibility projection
- implementation order
- focused verification commands

## Key Decisions

- Shared state models belong in `packages/ingestion-core`, not in collector apps, `packages/contracts`
  or panel/app-api UI code.
- Canonical shared tables should use the `ingestion_control` logical schema.
- `official_web.*` app-api columns remain compatibility projections during migration.
- authenticated-notice queue and child-task state become compatibility inputs to the shared model,
  not the permanent shared model itself.
- Phase 2 should plan official-web adapter implementation first because official-web currently has
  the larger gap: worker local JSON records still carry too much execution truth.

## Verification

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/README.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/REQUIREMENTS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/ROADMAP.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design
```

Result: passed.
