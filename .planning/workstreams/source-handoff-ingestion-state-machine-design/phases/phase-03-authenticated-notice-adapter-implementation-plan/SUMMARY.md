---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Authenticated-Notice Adapter Implementation Plan

## Result

Phase 3 is complete.

The workstream now has `AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`, which specifies:

- verified collector run ledger to `SourceRunRef` / `SourceHandoff` mapping
- bundle, manifest, notice attachment and file-release source object role mapping
- object verification policy for ledger evidence and live object-store checks
- queue lifecycle to `IngestionExecution` compatibility mapping
- current child-task contract to `IngestionChildTask` mapping
- processor profile mapping for run-level and child-task execution
- `notice` and `file_release` source-surface split
- historical repair and replay constraints
- implementation order and focused verification commands

## Key Decisions

- Authenticated notice does not require app-api control-plane ownership for this adapter.
- `ingestion_queue.notice_ingest_jobs` can remain a scheduling/compatibility input during
  migration, but canonical execution state belongs to `ingestion_control.ingestion_executions`.
- The collector run ledger remains source-run truth; shared handoff starts after verified ledger
  refs exist.
- Existing `authenticated_notice_child_task_state_contract.v1` maps directly into shared
  child-task evidence.
- `notice` and `file_release` remain separate source surfaces with separate handoff kinds.
- Local historical repair remains explicit operator-triggered upload + repair/synthetic ledger +
  handoff, not automatic local replay.

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
  .planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design
```

Result: passed.
