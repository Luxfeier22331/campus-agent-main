---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Source Handoff Ingestion State Machine Design

## Status Semantics

This workstream is active. The design/review phases are complete and implementation has started
from the shared contract/store foundation.

## Phase 0: State Machine Design Freeze

**Status:** completed on 2026-05-01.

**Goal:** Freeze the canonical state machine design for two collectors handing object-backed work
to one ingestion-worker.

**Scope:**

- Review official-web control-plane, run lifecycle, schema and handoff path.
- Review authenticated-notice object-native handoff, verified ledger, queue and child task path.
- Define shared entities: source run ref, source handoff, source object ref, object verification,
  ingestion execution, execution step and child task.
- Define state transitions, ownership matrix, idempotency, failure classification, operator queries
  and migration plan.
- Confirm this work does not open serving surfaces or merge collectors.

**Acceptance:**

- `STATE-MACHINE-DESIGN.md` exists and distinguishes source-specific run ownership from shared
  handoff/execution state.
- `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and registry entry are aligned.
- Targeted markdownlint and diff checks pass for this workstream.

## Phase 1: Contract Package And Store Plan

**Status:** completed on 2026-05-01.

**Goal:** Turn the design into implementation-ready contract and store tasks without touching
collector internals.

**Scope:**

- Define concrete Python model locations under `packages/ingestion-core`.
- Define Postgres logical schema/migration ownership.
- Define compatibility projections for current official-web and authenticated-notice states.
- Define focused tests before implementation.

**Acceptance:**

- Phase plan identifies exact files and migration order.
- No source-specific collector code changes are required to start.

**Evidence:** `./phases/phase-01-contract-package-and-store-plan/SUMMARY.md`.

## Phase 2: Official-Web Adapter Implementation Plan

**Status:** completed on 2026-05-01.

**Goal:** Plan official-web adapter from app-api terminal run/artifacts to canonical handoff and
execution projection.

**Scope:**

- Map `official_web.crawl_runs`, `run_artifacts`, outbox payload and worker callback fields.
- Define replacement path for worker local JSON `processingStatus`.
- Preserve app-api operator projection and no-promotion live seam.

**Acceptance:**

- Official-web adapter plan can be implemented without moving app-api crawl-run ownership.

**Evidence:** `./phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md`.

## Phase 3: Authenticated-Notice Adapter Implementation Plan

**Status:** completed on 2026-05-01.

**Goal:** Plan authenticated-notice adapter from verified run ledger and run-level queue to the
canonical handoff/execution model.

**Scope:**

- Map verified collector run ledger, bundle/manifest refs, source-object verification and current
  queue states.
- Preserve child task / processor profile semantics.
- Keep local historical repair path explicit and operator-triggered.

**Acceptance:**

- Authenticated-notice adapter plan can be implemented without requiring app-api control plane.

**Evidence:** `./phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md`.

## Phase 4: Worker Execution And Operator Projection Plan

**Status:** completed on 2026-05-01.

**Goal:** Plan the worker claim/execution/step/child-task implementation and operator-safe read
model projection.

**Scope:**

- Worker lease and retry loop.
- Step state write points.
- Child task evidence projection.
- app-api / panel read model boundary.
- Smoke and eval gates.

**Acceptance:**

- Implementation plan includes no-serving-opening acceptance gates.
- Operator projection does not require local worker files.

**Evidence:** `./phases/phase-04-worker-execution-and-operator-projection-plan/SUMMARY.md`.

## Phase 5: Implementation Readiness Review

**Status:** completed on 2026-05-01.

**Goal:** Verify that implementation can start without unresolved ownership or contract conflicts.

**Scope:**

- Review docs against source-of-truth architecture.
- Confirm migration does not break current official-web or authenticated-notice paths.
- Confirm tests and smoke lanes are sufficient.

**Acceptance:**

- Workstream is ready to switch from design to implementation planning.
- `.planning/WORKSTREAMS.md` current slice is updated with the next exact phase.

**Evidence:** `./phases/phase-05-implementation-readiness-review/SUMMARY.md`.

## Phase 6: Shared Contract And Store Implementation

**Status:** completed on 2026-05-01.

**Goal:** Implement the shared source-handoff / ingestion-execution contract, in-memory store,
Postgres store and compatibility projection helpers before wiring source-specific adapters.

**Scope:**

- Add canonical dataclasses, constants, validators and forbidden-payload checks.
- Add in-memory store with idempotency, lease, heartbeat, retry, terminal and event semantics.
- Add additive Postgres bootstrap for `ingestion_control`.
- Add official-web and authenticated-notice projection helper foundations.
- Add focused unit tests for model validation, store transitions, Postgres persistence and
  projection helpers.

**Acceptance:**

- Shared contract/store tests pass.
- No source-specific collector frontier is changed.
- No app-api authenticated-notice control-plane route is opened.
- No query-serving surface is opened.

**Evidence:** `./phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md`.

## Phase 7: Official-Web Adapter Implementation

**Status:** completed on 2026-05-01.

**Goal:** Wire official-web terminal run/artifact/outbox facts into canonical source handoff,
object verification and ingestion execution state while preserving existing app-api official-web
operator projection.

**Scope:**

- Use shared projection helpers to map terminal official-web facts into canonical handoffs.
- Demote worker local JSON handoff/execution status to debug/evidence.
- Enqueue verified stage-only executions from source-truth bundle refs.
- Project canonical execution state back to existing app-api official-web status fields.
- Preserve no-promotion default and no-serving-opening gates.

**Acceptance:**

- Current app-api official-web operator surfaces remain compatible.
- canonical handoff/object/execution/step rows exist for the no-promotion seam.
- Local worker JSON is no longer required for status truth.
- No registry current truth is promoted unless an explicit promotion gate is enabled.

**Evidence:** `./phases/phase-07-official-web-adapter-implementation/SUMMARY.md`.

## Phase 8: Authenticated-Notice Adapter Implementation

**Status:** completed on 2026-05-01.

**Goal:** Wire verified authenticated-notice collector run ledger and queue facts into canonical
source handoff, object verification, execution and child-task state while preserving queue
compatibility during migration.

**Scope:**

- Map verified collector run refs into `SourceRunRef` and `SourceHandoff`.
- Verify bundle, manifest and required source-byte object refs.
- Enqueue materialize-only executions from verified handoffs.
- Project queue and child-task states into canonical execution / child-task rows.
- Keep `ingestion_queue.notice_ingest_jobs` as scheduling inbox / compatibility projection during
  migration.

**Acceptance:**

- Queue compatibility tests still pass.
- Source-truth-only authenticated-notice run can write canonical handoff/execution state.
- Child-task reason codes survive canonical projection.
- No app-api authenticated-notice control-plane route is opened.
- No query-serving surface is opened.

**Evidence:** `./phases/phase-08-authenticated-notice-adapter-implementation/SUMMARY.md`.

## Phase 9: Worker Execution And Operator Projection Implementation

**Status:** ready.

**Goal:** Turn the canonical handoff/execution store into the shared worker runner and
operator-safe projection layer without making queue rows, local JSON files or panel reads the
source of truth.

**Scope:**

- Define shared worker claim and execution read/write helpers over `SourceHandoffStore`.
- Add operator-safe summary projection for handoff, execution, step and child-task state.
- Preserve existing official-web app-api and authenticated-notice queue compatibility projections.
- Keep panel access through app-api APIs only.
- Add no-serving-opening smoke/eval gates for both source channels.

**Acceptance:**

- Operators can inspect canonical handoff/execution status without reading worker local files.
- app-api official-web projection and authenticated-notice queue compatibility behavior remain
  stable.
- No panel direct database/object/local-file read is introduced.
- No collector frontier is changed.
- No query-serving surface is opened.
