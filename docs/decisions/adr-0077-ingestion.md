---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0077
status: accepted
created: 2026-07-13
updated: 2026-07-13
supersedes:
  - adr-0018-app-api-official-web-control-plane-ownership.md
  - adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md
  - adr-0032-internal-notice-notice-family-stratified-admission.md
  - adr-0054-ingestion-control-plane-and-kernel-boundary.md
  - adr-0070-official-web-target-first-consumption.md
---
# ADR-0077 Temporal Ingestion

## Context

The repository had accumulated source-specific HTTP lifecycle routes,
PostgreSQL run ledgers, task lease/closeout models, adapter callbacks, and v2
task envelopes that duplicated Temporal. Those paths made app-api,
ingestion-control, and collectors share workflow ownership and made an
artifact's storage location implicit.

## Decision

Every ingestion task is one Temporal workflow started by
`apps/ingestion-control`.

- `ingestion_task_envelope.v3` carries only task/run identity, a registry task
  id, and a SHA-256-pinned object-store input ref.
- `ingestion_task_registry.v3` freezes executor, source/target identity, and
  input/output contracts before workflow start.
- Active executors are only `source_collector` and `rust_kernel`.
- `source_collector` activities run in `apps/source-collector`; Rust kernels run
  through the ingestion-control bridge to `packages/ingestion-kernels-rs`.
- An activity returns exactly one `ingestion_task_result.v1` ref and a bounded
  summary. Detailed output remains in object storage.
- Temporal owns durable state, retry, timeout, heartbeat, cancellation, and
  task dispatch. PostgreSQL stores only bounded task projections and the latest
  official-web URL freshness state.
- Source-specific lifecycle endpoints, run ledgers, target-workset callbacks,
  app-api collector routes, and Python fallback executors do not exist.
- Source capture may emit deterministic classification metadata, but it does
  not run downstream admission, multimodal processing, projection rebuild, or
  query-serving read-model materialization.
- Official-web capture remains offline and cannot become query-enabled until a
  complete publication chain is implemented and admitted separately.

Long activities report coarse progress through Temporal Activity heartbeats.
They do not emit thousands of workflow signals or write progress rows. Input,
preparation, observations, and terminal output cross runtime boundaries as
digest-pinned object references.

## Consequences

- Workflow history stays bounded and replayable.
- Retry and cancellation have one owner.
- Collectors can change Crawlee/provider internals without changing task
  contracts.
- A task cannot infer source, target, executor, or output contract from mutable
  request fields.
- Reintroducing a source-specific route or ledger requires a new ADR; it cannot
  be added as a compatibility path.

## References

- [Temporal Activities](https://docs.temporal.io/activities)
- [Temporal Activity heartbeats](https://docs.temporal.io/encyclopedia/detecting-activity-failures#activity-heartbeat)
- [Temporal cancellation](https://docs.temporal.io/develop/typescript/cancellation)
- `docs/architecture/system/data-plane.md`
- `docs/runbooks/ingestion.md`
