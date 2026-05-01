---
doc_type: review
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Implementation Readiness Review

## Verdict

Implementation is ready to start from the shared contract/store slice.

There are no unresolved design blockers across source ownership, canonical execution ownership,
migration posture, operator projection boundary or no-serving-opening gates.

## Documents Reviewed

- `STATE-MACHINE-DESIGN.md`
- `CONTRACT-STORE-PLAN.md`
- `OFFICIAL-WEB-ADAPTER-PLAN.md`
- `AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- `WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web-source-truth-schema.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`

## Ownership Consistency

The design keeps source-specific run ownership intact.

| Area | Review result |
| --- | --- |
| official-web source run truth | stays in `apps/app-api` crawl-run / artifact / outbox control plane |
| authenticated-notice source run truth | stays in collector/source ledger and verified object refs |
| shared handoff truth | moves to `ingestion_control.source_handoffs` and related object verification rows |
| shared execution truth | moves to `ingestion_control.ingestion_executions` |
| official-web operator projection | stays app-api-owned and projects from canonical execution state |
| authenticated-notice operator projection | stays worker/queue compatibility side until a later app-api surface is admitted |
| protected-panel-web | continues to read app-api APIs only |

No plan merges the two collectors, moves authenticated-notice control-plane ownership into
app-api, or makes panel read Postgres/object storage/local files/telemetry sinks directly.

## Contract Readiness

The canonical implementation boundary is ready:

- `SourceRunRef` keeps source-specific ledger identity without absorbing source run lifecycle.
- `SourceHandoff` is the durable cross-runtime handoff contract.
- `SourceObjectRef` and `ObjectVerification` make required object identity durable and queryable.
- `IngestionExecution` separates execution state from result kind.
- `IngestionStep`, `IngestionChildTask` and `ingestion_events` cover stage evidence and child
  work without making local trace files canonical.
- Forbidden payload rules explicitly reject raw body fields, raw media/OCR payloads, credential
  material, local production paths and downstream serving payloads.

Implementation can start in `packages/ingestion-core` without importing app-api TypeScript,
panel, supervisor, retrieval or runtime-specific infrastructure into the contract layer.

## Store And Migration Readiness

The migration path is additive and compatible with current source paths:

- add the `ingestion_control` logical schema before replacing current projections.
- keep official-web `ingestion_execution_*` columns as compatibility projection during migration.
- keep authenticated-notice queue rows as scheduling inbox / compatibility projection during
  migration.
- keep local JSON, operations dirs and trace files as debug/evidence until operator cleanup policy
  removes them.
- do not auto-replay historical local files.
- do not mutate terminal execution rows to retry; create explicit repair/replay executions with
  provenance.

The first implementation slice should not delete existing rows, local evidence, queue columns or
worker callback compatibility paths.

## Adapter Readiness

### Official Web

The official-web adapter is implementation-ready because the plan defines:

- terminal run / artifact / outbox event to `SourceRunRef` and `SourceHandoff` mapping.
- required `source_truth_bundle`, manifest and page-level object verification policy.
- stage-only execution as default, with promotion requiring explicit gate enablement.
- app-api compatibility projection from canonical execution state.
- local worker JSON demotion to debug/evidence.

### Authenticated Notice

The authenticated-notice adapter is implementation-ready because the plan defines:

- verified collector ledger to `SourceRunRef` and `SourceHandoff` mapping.
- bundle, manifest, notice attachment and file-release object role mapping.
- `notice` and `file_release` source-surface split.
- queue-to-execution compatibility projection.
- existing child-task contract projection into `IngestionChildTask`.
- historical repair as explicit operator work, not automatic local replay.

## Worker And Operator Readiness

The shared worker execution plan is implementation-ready because it defines:

- claim, lease, heartbeat, retry, dead-letter and terminal semantics.
- shared runner and processor adapter responsibilities.
- step write points for verify, replay/import, validation, chunk audit, media gate, admission,
  downstream materialization, promotion, cleanup and smoke.
- child-task projection requirements for authenticated notice.
- operator-safe summary shape and forbidden fields.
- telemetry as evidence, not canonical state.

The implementation sequence should keep canonical state writes before compatibility projection and
before telemetry emission where ordering matters.

## Test Readiness

Required implementation gates are defined across all planned slices:

| Slice | Required test coverage |
| --- | --- |
| contract/store | validators, forbidden payload fields, idempotency, leases, retry/dead-letter, terminal states |
| Postgres store | schema bootstrap, skip-locked claim, unique idempotency and transition persistence |
| official-web adapter | artifact mapping, bundle expansion, object verification, app-api projection compatibility |
| authenticated-notice adapter | ledger mapping, manifest/source-byte verification, queue projection, child-task projection |
| shared runner | claim/heartbeat/complete/fail/dead-letter transitions and failure classification |
| operator projection | sanitized summaries and forbidden-field omission/rejection |
| no-serving gate | no new serving alias, no query-enabled collection drift, no implicit promotion/replay |

The first code phase should use the contract/store tests as the narrow gate before wiring either
source-specific adapter.

## Non-Goals Reconfirmed

- Do not merge `official-web-collector` and `authenticated-notice-collector`.
- Do not move authenticated-notice source-run control plane into app-api.
- Do not make app-api the canonical worker execution store.
- Do not make panel read database tables, object storage, local worker files or telemetry sinks.
- Do not open official-web fresh news, internal notice, service status or any other query-serving
  surface.
- Do not treat local JSON, local export paths, trace files or telemetry payloads as system truth.
- Do not introduce Temporal, Argo, Dagster or another workflow runtime as a required dependency in
  this implementation.

## Residual Risks

These are implementation risks, not design blockers:

- Current worktree has unrelated dirty files from other workstreams; implementation must keep write
  scope explicit.
- The implementation will span Python ingestion-core/worker and app-api TypeScript official-web
  projection, so contract-first sequencing is required.
- Postgres migration ordering must stay additive until compatibility projections are proven.
- Existing official-web worker callbacks and authenticated-notice queue compatibility paths must
  remain until projection parity is verified.
- Historical completed rows may be backfilled into read-only summaries, but must not trigger
  automatic re-execution.

## Implementation Start Criteria

Implementation may start when the next phase is explicitly scoped to the shared contract/store
slice.

The first implementation phase should produce:

- `source_handoff_state_machine.py`
- `source_handoff_store.py`
- `source_handoff_postgres.py`
- `source_handoff_projection.py`
- focused unit tests for state validation, store transitions, Postgres persistence and projection
  helpers
- no source-specific collector frontier changes
- no serving surface opening

## Next Phase

Next phase: Phase 6 `Shared Contract And Store Implementation`.

Phase 6 should implement the shared contract/store foundation before official-web or
authenticated-notice adapters are wired.
