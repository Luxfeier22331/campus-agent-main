---
doc_type: closeout
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Closeout: Source Handoff Ingestion State Machine Design

## Decision

This workstream is complete.

It delivered the canonical source-handoff state machine design and the foundational implementation
needed by both current source channels:

- shared contract, validators and store protocol
- in-memory canonical store and Postgres schema bootstrap
- official-web canonical adapter
- authenticated-notice canonical adapter
- shared execution runner helper
- operator-safe projection helper
- worker consume/show shells
- no-serving-opening guard

The remaining gaps are production adoption gaps, not unresolved state-machine design gaps. They are
captured as dormant follow-up seed `SEED-003: Source Handoff Runtime Store Adoption`.

## Requirement Coverage

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| distinguish source-specific run lifecycle from shared handoff/execution lifecycle | covered | `STATE-MACHINE-DESIGN.md`, `CONTRACT-STORE-PLAN.md`, Phase 6 models |
| one canonical handoff model usable by both collectors | covered | `SourceHandoff`, official-web adapter, authenticated-notice adapter |
| object verification as durable state | covered | `ObjectVerification`, adapter checksum/size tests |
| execution state separate from result kind | covered | `IngestionExecution.status` and `result_kind` validation |
| step / child-task state with retry and terminal semantics | covered | `IngestionStep`, `IngestionChildTask`, Phase 8 child-task projection |
| official-web and authenticated-notice compatibility projection during migration | covered | official-web callback compatibility, authenticated queue compatibility |
| preserve source ownership boundaries | covered | app-api remains official-web run owner; authenticated notice remains ledger/collector owned |
| verification gates before serving opening | covered | no-serving gate and Phase 6-9 tests |
| answer operator questions without local worker files | covered for foundation | operator projection over canonical store records |

## Migration Readiness

The implementation is ready for code-level adoption by source-specific flows through optional
`source_handoff_store` parameters and shared runner helpers.

It is not yet a production runtime deployment by itself because the following adoption pieces are
intentionally deferred:

- `PostgresSourceHandoffStore` implementation over the Phase 6 `ingestion_control` schema.
- production worker store wiring for `campus-ingestion-consume-source-handoff-executions` and
  `campus-ingestion-show-source-handoff-executions`.
- app-api operator read projection admission, if a product/operator surface is later approved.
- migration/backfill of historical official-web worker JSON and authenticated-notice queue rows
  into canonical operator records, if operators need old-run visibility.

These are deployment/operator-adoption slices. They should not reopen the state-machine design
unless they change the canonical contract, source ownership, serving policy or panel boundary.

## Boundaries Preserved

- No collector merge was introduced.
- No collector frontier, portal authentication or URL admission rule was changed.
- No direct collector write to document registry, projection read model, chunk, index or serving
  alias was introduced.
- No local filesystem path is canonical handoff truth.
- No panel-owned state machine or telemetry-sink-owned state machine was introduced.
- No app-api authenticated-notice control-plane route was opened.
- No protected-panel-web direct database, object storage or local file read was introduced.
- No query-serving surface was opened.

## Reopen Rule

Reopen this workstream only if one of these happens:

- source-specific collector ownership or run-ledger ownership is changed
- canonical `SourceHandoff`, `ObjectVerification`, `IngestionExecution`, `IngestionStep` or
  `IngestionChildTask` semantics are rewritten
- worker local JSON or queue rows are again treated as canonical execution truth
- app-api/panel starts reading raw ingestion-control rows, object storage, worker local files or
  telemetry sinks as truth
- a new source channel needs to join the shared source-handoff state machine
- no-serving-opening gates fail because ingestion state changes implicitly open query-serving

Use `SEED-003` for normal production adoption of the existing design.
