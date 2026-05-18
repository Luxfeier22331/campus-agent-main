---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Official-Web Adapter Implementation Plan

## Goal

Plan the official-web adapter from app-api terminal run/artifacts/outbox facts to canonical source
handoff and ingestion execution state.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/data/app-api-official-web-schema.md`
- `apps/app-api/src/db/schema/official-web.ts`
- `apps/app-api/src/modules/official-web-command/store.ts`
- `apps/app-api/src/modules/official-web-projection/service.ts`
- `apps/app-api/src/modules/integration/official-web-handoff.ts`
- `apps/app-api/src/modules/official-web-execution/service.ts`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_receiver.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_models.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`

## Deliverables

- `OFFICIAL-WEB-ADAPTER-PLAN.md`
- updated `README.md`
- updated `ROADMAP.md`
- updated `STATE.md`
- updated `.planning/WORKSTREAMS.md`

## Work Items

1. Map app-api terminal event, crawl run and artifact facts into `SourceRunRef`,
   `SourceHandoff` and `SourceObjectRef`.
2. Define object verification for official-web bundle and page-level source-truth refs.
3. Define `IngestionExecution` and `IngestionStep` mapping for current stage/promote worker path.
4. Define replacement semantics for worker local JSON `processingStatus`.
5. Define app-api compatibility projection from canonical execution state.
6. Define implementation order, migration notes and focused test plan.
7. Verify planning files with markdownlint and diff checks.

## Acceptance

- No runtime implementation code is changed in Phase 2.
- The plan keeps app-api as official-web crawl-run control-plane owner.
- The plan demotes worker local JSON to debug/evidence instead of canonical truth.
- The plan keeps no-promotion stage-only path explicit.
- Phase 3 can proceed to authenticated-notice adapter planning.
