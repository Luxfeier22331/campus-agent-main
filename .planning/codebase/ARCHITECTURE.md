# Architecture

**Analysis Date:** 2026-04-26

## Pattern Overview

**Overall:** Supervisor-led layered orchestrator with a dedicated execution boundary, offline ingestion/data plane, and shared Worker application/web surfaces, keeping retrieval, storage, and contracts tightly separated.

**Key Characteristics:**
- Policy-driven orchestrated execution path: the current forward product topology is
  `public-chat-web -> app-api -> execution-control -> Temporal -> activity worker ->
  supervisor-agent-worker -> agent/tool capability` for semantic answer execution and
  `protected-panel-web -> app-api` for operator read surfaces. Go
  `apps/execution-control` owns admission, deterministic runtime policy, Temporal
  command/query, structured planning, response finalization, observability, and
  sanitized run/step projection; Python `apps/supervisor-agent-worker` only dispatches
  private semantic work items to concrete agent/tool packages.
- Phase-1 data plane enforces S3-compatible object storage, registries, and Qdrant-backed chunk indexes for `student_rules`/`curriculum_plan`, most of which is described in `docs/architecture/system/data-plane-architecture.md` and implemented under `packages/ingestion-core/src/campus_ingestion_core`.
- Explicit boundary governance: `packages/contracts` holds allowed corpora, trace contexts, and error schemas, while `packages/shared` keeps only constants that other packages may import without pulling runtime infrastructure details into coordination logic.

## Layers

**Transport & Runtime Surfaces (`apps/`):**
- Purpose: host execution, ingestion, the shared Worker application backend, and the current public/protected Worker web surfaces.
- Contains: Go `apps/execution-control/internal/*`, Python
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*`,
  `apps/ingestion-worker/src/campus_ingestion_worker/*`, `apps/app-api/src/*`,
  `apps/public-chat-web/src/*`, `apps/public-docs/*`, and `apps/protected-panel-web/src/*`.
- Depends on: `packages/contracts` for request/response types and
  `packages/ingestion-core` for ingestion behaviors.
- Used by: browser clients, operator workflows, `official_web` control-plane flows, projection handoff construction, and CLI tooling for raw ingestion jobs.

**Supervisor Execution And Agent Worker Layer:**
- Purpose: keep deterministic execution control in Go while preserving Python for
  semantic agent dispatch.
- Contains: `apps/execution-control/internal/runtimepolicy`,
  `apps/execution-control/internal/structuredplanning`,
  `apps/execution-control/internal/httpapi`, and
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*`.
- Depends on: `packages/contracts` for schemas and the concrete agent packages
  injected by the worker runtime.
- Used by: `apps/app-api` execution calls and the private bridge between Go runtime
  and Python agents.

**Agent Capability Layer (`packages/rag-agent`, `packages/navigation-agent`, `packages/campus-services-agent`, `packages/notice-agent`):**
- Purpose: implement typed capability boundaries under supervisor execution.
- Contains: `packages/rag-agent/src/campus_rag_agent/*`,
  `packages/navigation-agent/src/campus_navigation_agent/*`,
  `packages/campus-services-agent/src/campus_services_agent/*`, and
  `packages/notice-agent/src/campus_notice_agent/*`.
- Depends on: `packages/contracts` for handoff models; `rag-agent` also depends on
  `packages/retrieval-core`.
- Used by: Go typed tool runtime for opened structured paths and the Python agent worker
  for semantic delegate paths.

**Retrieval & Evidence Layer (`packages/retrieval-core`):**
- Purpose: translate a `RetrievalRequest` into evidence pulled from registries and a vector store, abstracting Qdrant/LlamaIndex details.
- Contains: `packages/retrieval-core/src/campus_retrieval_core/service.py`, `.backend_qdrant.py`, `.models.py`, `.settings.py`, and the runtime profile loader in `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`.
- Depends on: ingestion registries, Qdrant, embedding provider clients, and `packages/contracts` for `EvidenceBundle`.
- Used by: `packages/rag-agent` and tests under `tests/retrieval/`.

**Ingestion & Storage Layer (`packages/ingestion-core`, `configs/ingestion`, `var/`):**
- Purpose: consume raw documents, normalize them into Postgres-backed registries, chunk/embed them, and persist artifacts in an S3-compatible store backed by MinIO for the current local/shared-dev shape.
- Contains: `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`, `.process.py`, `.object_store.py`, `.registry.py`, `.models.py`, `.settings.py`, and per-corpus configs under `configs/ingestion/*/runtime-profile.json`.
- Depends on: `packages/contracts` for corpus enums, `packages/shared` for constants, and infrastructure (object store, Postgres registry, Qdrant) described in `docs/architecture/system/data-plane-architecture.md`.
- Used by: `apps/ingestion-worker` entry scripts, rebuild helpers, and `packages/retrieval-core` via runtime profiles that gate `RetrievalBackend`.

**Contracts & Shared Utilities (`packages/contracts`, `packages/shared`):**
- Purpose: freeze the handoff schemas (request, response, evidence bundle, audit info, error codes) and expose constants without coupling to runtime hosts.
- Contains: `packages/contracts/src/campus_contracts/models.py`, `__init__.py`, and `packages/shared/src/campus_shared/constants.py`.
- Depends on: `typing`, `dataclasses`.
- Used by: every layer to keep typing, validation, and naming consistent (e.g., `ALLOWED_CORPORA`, `ActorContext`, `TraceContext`, `ErrorInfo`).

## Data Flow

**Answer request flow:**

1. Browser chat requests hit `apps/public-chat-web/src/index.ts`, which stays same-site to `apps/app-api`.
2. `apps/app-api/src/app.ts` owns product-layer auth/session/principal mapping, request projection, telemetry hooks, and the internal bridge into `apps/execution-control` when a supervisor execution is needed.
3. Go `apps/execution-control/internal/httpapi` accepts only the internal
   `/internal/execution/runs*` command/query contract, admits the request, applies
   runtime policy, creates sanitized run projection, and starts a Temporal workflow.
4. Temporal schedules typed workflow/activity work on capability task queues. The active
   answer serving path does not use PG lease acquisition or legacy answer routes.
5. RAG / notice / navigation / campus services / finalization run as typed activities or
   agent-as-tool activities. Semantic work reaches Python `apps/supervisor-agent-worker`
   only through the private bridge with bounded projection refs and sanitized payloads.
6. The selected capability validates the request, performs retrieval or semantic work,
   and returns a typed projection result.
7. Go `apps/execution-control` writes sanitized run/event/step projection and finalizes
   product response state for `app-api`; browser and panel surfaces read product
   projection, not Temporal history or raw provider traces.

**Ingestion/data-plane flow:**

1. `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` or `submit_raw_ingestion_job.py` invokes `packages/ingestion-core` entrypoints (`raw_ingestion.process_raw_ingestion_job` or `.submit_raw_ingestion_job`).
2. The ingestion core reads `configs/ingestion/<corpus>/<collection>/runtime-profile.json` via `campus_ingestion_core.corpus_profiles`, validates artifact modes, and writes source/derived objects through `campus_ingestion_core.object_store`.
3. Registry updates (via `campus_ingestion_core.registry.DocumentRegistry`/`RawAssetRegistry`) persist metadata in Postgres, which `packages/retrieval-core` later reads; `var/` is not the runtime registry truth source.
4. Chunking, embedding, and Qdrant writes happen as part of `campus_ingestion_core.chunking`/`embed`, and `packages/retrieval-core` uses `QdrantRetrievalBackend` plus `DocumentRegistry` data to produce `EvidenceBundle`.

**State Management:**
- Source and derived artifacts live in the S3-compatible tier even when served by local MinIO (`packages/ingestion-core/src/campus_ingestion_core/object_store.py` and `docs/architecture/system/data-plane-architecture.md`), while `DocumentRegistry` and `RawAssetRegistry` in `packages/ingestion-core/src/campus_ingestion_core/registry.py` maintain versioned metadata in Postgres for the env-backed runtime path.
- Chunk metadata and embeddings are exposed through Qdrant (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`), and corpora runtime profiles gate query availability (`packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` with config roots in `configs/ingestion/`).

## Key Abstractions

**Handoff Contracts (`packages/contracts/src/campus_contracts/models.py`):**
- Purpose: centralize request/response/evidence/error enums such as `SupervisorRequest`, `AgentRequest`, `AgentResponse`, `EvidenceBundle`, `TraceContext`, and `ErrorInfo`.
- Examples: `ActorContext` shapes inbound auth metadata, while `ALLOWED_CORPORA` prevents unsupported corpora from leaking into the runtime.
- Pattern: frozen dataclasses with `__post_init__` validation so every layer shares the same schema.

**Runtime Policy, Bridge, And Agent Dispatch:**
- Purpose: keep runtime decisions in Go and private semantic dispatch in Python.
- Examples: Go `runtimepolicy` / `structuredplanning` build deterministic decisions;
  Python `bridge_v6_parser.py` and `agent_delegates.py` consume the resulting
  `AgentRequest`.
- Pattern: fail-closed Go runtime policy plus injected Python agent delegates.

**Agent & Retrieval Stack (`packages/rag-agent/src/campus_rag_agent` + `packages/retrieval-core/src/campus_retrieval_core`):**
- Purpose: `delegate_to_rag_agent` orchestrates query validation, retrieval
  (`retrieve_sources`), confidence scoring, and grounded response composition.
- Examples: `RetrievalRequest` normalizes query details, while `QdrantRetrievalBackend` wraps Qdrant, guardrails defined by `CorpusRuntimeProfile`, and `EvidenceBundle` captures chunk-level metadata.
- Pattern: composable call chain where agent code handles semantic logic and retrieval
  code handles vector search and registry lookups.

**Ingestion & Registry (`packages/ingestion-core/src/campus_ingestion_core`):**
- Purpose: ingest raw/corpus-specific artifacts, persist them via object store helpers, and surface metadata through registries and import reports.
- Examples: `process_raw_ingestion_job` produces `ImportReport`, `DocumentRegistry`/`RawAssetRegistry` enforce keyed schemas, and `S3ObjectStoreClientFactory` hides MinIO vs S3 details.
- Pattern: procedural ingestion pipeline with dataclasses for settings/records and env-backed Postgres registries.

## Entry Points

**`apps/app-api/src/index.ts` & `app.ts`:**
- Location: shared Worker backend entry; responsibilities include auth/chat/operator/official-web HTTP surfaces, runtime command/projection handling, internal bridge admission, and telemetry wiring.

**`apps/public-chat-web/src/index.ts` & `apps/protected-panel-web/src/index.ts`:**
- Location: public and protected Worker web surfaces; responsibilities include browser-facing routing, internal proxy/BFF behavior, and trace propagation into `app-api`.

**`apps/execution-control/cmd/execution-control` & `internal/httpapi`:**
- Location: Go execution-control surface for `/internal/execution/runs*`, `/healthz`,
  `/readyz`, `/metrics`, Temporal command/query, cancellation, sanitized projection,
  finalization, and audit.
- Triggers: internal HTTP requests from `apps/app-api`; responsibilities include caller
  auth, runtime policy, Temporal workflow control, bridge projection, finalization,
  metrics, and audit.

**`apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/app.py` & `api.py`:**
- Location: private Python bridge worker; responsibilities include bridge v6 parsing,
  agent delegate injection, prompt runtime assets, and returning `AgentResponse`.

**`packages/rag-agent/src/campus_rag_agent/service.py`:**
- Location: knowledge agent entrypoint; responsibilities include user goal validation,
  retrieving evidence, handling retrieval errors, and composing grounded answers.

**`apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` & `submit_raw_ingestion_job.py`:**
- Location: ingestion runtime shells; responsibilities include invoking `campus_ingestion_core.process_raw_ingestion_job`/`submit_raw_ingestion_job` and dumping `ImportReport`.

## Error Handling

**Strategy:** Go runtime policy and bridge errors fail closed at `apps/execution-control`;
agent-level semantic errors return typed `AgentResponse` values for Go finalization.

**Patterns:**
- Go `apps/execution-control/internal/httpapi` maps admission, bridge, timeout, and direct
  runtime failures into terminal responses.
- `packages/rag-agent/src/campus_rag_agent/service.py` catches
  `CorpusQueryDisabledError` and `RetrievalBackendError` from `packages/retrieval-core`,
  returning statuses like `error`, `needs_clarification`, or `no_answer`.
- `SupervisorRequest.__post_init__`, `AgentRequest.__post_init__`, `RetrievalRequest.__post_init__`, and `CorpusRuntimeProfile` class validators prevent invalid corpora, top_k, or artifact modes from propagating.

## Cross-Cutting Concerns

**Authentication:** Go `apps/execution-control/internal/httpapi` verifies internal caller
auth and consumes the typed actor/context projection produced by `apps/app-api`.

**Configuration:** Go supervisor config and Python package settings read runtime
overrides from environment variables, keeping host, embedding provider, and registry
URLs adjustable per deployment.

**Validation:** Dataclasses across contracts (`packages/contracts/src/campus_contracts/models.py`), retrieval (`RetrievalRequest`), and ingestion (`CorpusRuntimeProfile`) run `__post_init__` checks so invalid corpora/top_k/artifact mode combinations fail fast.

**Auditing & Trace:** Go `apps/execution-control` owns execution audit summary,
response observability, metrics, and OTel seams; the Python agent worker does not
publish public runtime truth.

**State & Runtime Profiles:** `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` loads `configs/ingestion/<corpus>/<collection>/runtime-profile.json` to gate query-serving and index bindings, while `var/` now mainly holds local artifacts such as import reports and backups rather than canonical registry truth.
