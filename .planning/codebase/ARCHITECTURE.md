# Architecture

**Analysis Date:** 2026-03-29

## Pattern Overview

**Overall:** Supervisor-led layered orchestrator with dedicated execution, ingestion, and Worker/web surfaces, keeping retrieval, storage, and contracts tightly separated.

**Key Characteristics:**
- Policy-driven multi-agent path: client requests cross `apps/supervisor-api` into `packages/supervisor-core`, which frames a `SupervisorRequest`, routes to an explicit specialist target, and delegates to `packages/rag-specialist` or `packages/availability-specialist` through the shared `SupervisorRequest` / `SpecialistRequest` / `SupervisorResponse` contracts documented in `packages/contracts/src/campus_contracts/models.py` and `docs/architecture/long-term-architecture.md`.
- Phase-1 data plane enforces S3-compatible object storage, registries, and Qdrant-backed chunk indexes for `student_handbook`/`curriculum_plan`, most of which is described in `docs/architecture/phase1-ingestion-and-storage-architecture.md` and implemented under `packages/ingestion-core/src/campus_ingestion_core`.
- Explicit boundary governance: `packages/contracts` holds allowed corpora, trace contexts, and error schemas, while `packages/shared` keeps only constants that other packages may import without pulling runtime infrastructure details into coordination logic.

## Layers

**Transport & Runtime Surfaces (`apps/`):**
- Purpose: host execution, ingestion, Worker/web shells, and the minimal merged `app-api` seam.
- Contains: `apps/supervisor-api/src/campus_supervisor_api/*`, `apps/ingestion-worker/src/campus_ingestion_worker/*`, `apps/app-api/src/campus_app_api/projection.py`, `apps/public-entry-worker`, and `apps/protected-internal-panel`.
- Depends on: `packages/supervisor-core` for orchestration, `packages/contracts` for request/response types, and `packages/ingestion-core` for ingestion behaviors.
- Used by: HTTP/Worker clients for answers, projection handoff construction, and CLI tooling for raw ingestion jobs.

**Supervisor Coordination Layer (`packages/supervisor-core`):**
- Purpose: normalize `SupervisorRequest`, apply routing policy, audit outcomes, and assemble final responses.
- Contains: `packages/supervisor-core/src/campus_supervisor_core/agent.py`, `.routing.py`, `.response.py`, `.policy.py`, `.audit.py`, and `context.py`.
- Depends on: `packages/contracts` for schemas, `packages/rag-specialist` via the delegate gateway, and `packages/shared` for lightweight constants.
- Used by: `apps/supervisor-api` routes and any future supervisors that need the same policy plumbing; guardrails are spelled out in `packages/supervisor-core/AGENTS.md`.

**Specialist Capability Layer (`packages/rag-specialist`, `packages/availability-specialist`):**
- Purpose: implement typed specialist boundaries under the supervisor, including grounded retrieval answers and controlled availability probes.
- Contains: `packages/rag-specialist/src/campus_rag_specialist/service.py`, `.agent.py`, `.confidence.py`, plus `packages/availability-specialist/src/campus_availability_specialist/service.py`.
- Depends on: `packages/contracts` for actor/evidence/error models; `rag-specialist` also depends on `packages/retrieval-core`.
- Used by: the supervisor layer when `route_request` returns `rag-specialist` or `availability-specialist`.

**Retrieval & Evidence Layer (`packages/retrieval-core`):**
- Purpose: translate a `RetrievalRequest` into evidence pulled from registries and a vector store, abstracting Qdrant/LlamaIndex details.
- Contains: `packages/retrieval-core/src/campus_retrieval_core/service.py`, `.backend_qdrant.py`, `.models.py`, `.settings.py`, and the runtime profile loader in `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`.
- Depends on: ingestion registries, Qdrant, embedding provider clients, and `packages/contracts` for `EvidenceBundle`.
- Used by: `packages/rag-specialist` and tests under `tests/retrieval/`.

**Ingestion & Storage Layer (`packages/ingestion-core`, `configs/ingestion`, `var/`):**
- Purpose: consume raw documents, normalize them into Postgres-backed registries, chunk/embed them, and persist artifacts in an S3-compatible store backed by MinIO for the current local/shared-dev shape.
- Contains: `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`, `.process.py`, `.object_store.py`, `.registry.py`, `.models.py`, `.settings.py`, and per-corpus configs under `configs/ingestion/*/runtime-profile.json`.
- Depends on: `packages/contracts` for corpus enums, `packages/shared` for constants, and infrastructure (object store, Postgres registry, Qdrant) described in `docs/architecture/phase1-ingestion-and-storage-architecture.md`.
- Used by: `apps/ingestion-worker` entry scripts, rebuild helpers, and `packages/retrieval-core` via runtime profiles that gate `RetrievalBackend`.

**Contracts & Shared Utilities (`packages/contracts`, `packages/shared`):**
- Purpose: freeze the handoff schemas (request, response, evidence bundle, audit info, error codes) and expose constants without coupling to runtime hosts.
- Contains: `packages/contracts/src/campus_contracts/models.py`, `__init__.py`, and `packages/shared/src/campus_shared/constants.py`.
- Depends on: `typing`, `dataclasses`.
- Used by: every layer to keep typing, validation, and naming consistent (e.g., `ALLOWED_CORPORA`, `ActorContext`, `TraceContext`, `ErrorInfo`).

## Data Flow

**Answer request flow:**

1. Incoming HTTP/AgentOS requests hit `apps/supervisor-api/src/campus_supervisor_api/app.py`, where `build_routes` wires `/api/v1/answer` to `handle_answer` (`apps/supervisor-api/src/campus_supervisor_api/api.py`).
2. `handle_answer` authenticates using `map_actor_context` (`.auth.py`), constructs a `SupervisorRequest`, and hands it to `packages/supervisor-core/src/campus_supervisor_core/agent.py`.
3. `SupervisorAgent.handle` builds a `SupervisorRequestContext`, routes the request via `routing.route_request`, frames a `SpecialistRequest`, and invokes the configured specialist delegate.
4. The selected specialist validates the request, performs retrieval or controlled probing, and returns a typed `SpecialistResponse`.
5. Supervisor finalizes the specialist response into `SupervisorResponse`, audits via `packages/supervisor-core/src/campus_supervisor_core/audit.py`, and the API serializes that `SupervisorResponse`.

**Ingestion/data-plane flow:**

1. `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` or `submit_raw_ingestion_job.py` invokes `packages/ingestion-core` entrypoints (`raw_ingestion.process_raw_ingestion_job` or `.submit_raw_ingestion_job`).
2. The ingestion core reads `configs/ingestion/<corpus>/<collection>/runtime-profile.json` via `campus_ingestion_core.corpus_profiles`, validates artifact modes, and writes source/derived objects through `campus_ingestion_core.object_store`.
3. Registry updates (via `campus_ingestion_core.registry.DocumentRegistry`/`RawAssetRegistry`) persist metadata in Postgres, which `packages/retrieval-core` later reads; `var/` is not the runtime registry truth source.
4. Chunking, embedding, and Qdrant writes happen as part of `campus_ingestion_core.chunking`/`embed`, and `packages/retrieval-core` uses `QdrantRetrievalBackend` plus `DocumentRegistry` data to produce `EvidenceBundle`.

**State Management:**
- Source and derived artifacts live in the S3-compatible tier even when served by local MinIO (`packages/ingestion-core/src/campus_ingestion_core/object_store.py` and `docs/architecture/phase1-ingestion-and-storage-architecture.md`), while `DocumentRegistry` and `RawAssetRegistry` in `packages/ingestion-core/src/campus_ingestion_core/registry.py` maintain versioned metadata in Postgres for the env-backed runtime path.
- Chunk metadata and embeddings are exposed through Qdrant (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`), and corpora runtime profiles gate query availability (`packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` with config roots in `configs/ingestion/`).

## Key Abstractions

**Handoff Contracts (`packages/contracts/src/campus_contracts/models.py`):**
- Purpose: centralize request/response/evidence/error enums such as `SupervisorRequest`, `SpecialistRequest`, `SpecialistResponse`, `EvidenceBundle`, `TraceContext`, and `ErrorInfo`.
- Examples: `ActorContext` shapes inbound auth metadata, while `ALLOWED_CORPORA` prevents unsupported corpora from leaking into the runtime.
- Pattern: frozen dataclasses with `__post_init__` validation so every layer shares the same schema.

**Supervisor Context & Audit (`packages/supervisor-core/src/campus_supervisor_core/context.py` + `.audit.py`):**
- Purpose: wrap incoming requests in `SupervisorRequestContext`, drive routing policies (`routing.route_request`), and project minimal audit data (`SupervisorAuditRecord`).
- Examples: `SupervisorAgent.handle` uses the context to select `primary_corpus` and trace IDs, then emits `source_doc_ids` extracted via `response.source_doc_ids_from_response`.
- Pattern: policy-driven orchestration with per-call dataclass projections and audit record builders.

**Specialist & Retrieval Stack (`packages/rag-specialist/src/campus_rag_specialist` + `packages/retrieval-core/src/campus_retrieval_core`):**
- Purpose: `delegate_to_rag_agent` orchestrates query validation, retrieval (`retrieve_sources`), confidence scoring, and grounded response composition (`RagSpecialistAgent.compose_answer`).
- Examples: `RetrievalRequest` normalizes query details, while `QdrantRetrievalBackend` wraps Qdrant, guardrails defined by `CorpusRuntimeProfile`, and `EvidenceBundle` captures chunk-level metadata.
- Pattern: composable call chain where specialist code handles actor-level logic and retrieval code handles vector search and registry lookups.

**Ingestion & Registry (`packages/ingestion-core/src/campus_ingestion_core`):**
- Purpose: ingest raw/corpus-specific artifacts, persist them via object store helpers, and surface metadata through registries and import reports.
- Examples: `process_raw_ingestion_job` produces `ImportReport`, `DocumentRegistry`/`RawAssetRegistry` enforce keyed schemas, and `S3ObjectStoreClientFactory` hides MinIO vs S3 details.
- Pattern: procedural ingestion pipeline with dataclasses for settings/records and env-backed Postgres registries.

## Entry Points

**`apps/supervisor-api/src/campus_supervisor_api/app.py` & `api.py`:**
- Location: API runtime surfaces, routing `/api/v1/answer`, `/healthz`, `/readyz`, and wiring `ApiSettings`.
- Triggers: HTTP/AgentOS requests; responsibilities include auth (`map_actor_context`), trace propagation, audit sink wiring, and delegating to `supervisor_core.handle_request`.

**`packages/supervisor-core/src/campus_supervisor_core/agent.py`:**
- Location: supervisor logic entry; responsibilities include context construction, routing, specialist delegation, and response assembly before returning `SupervisorResponse`.

**`packages/rag-specialist/src/campus_rag_specialist/service.py`:**
- Location: specialist entrypoint used by the supervisor; responsibilities include user goal validation, retrieving evidence, handling retrieval errors, and composing answers via `RagSpecialistAgent`.

**`apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` & `submit_raw_ingestion_job.py`:**
- Location: ingestion runtime shells; responsibilities include invoking `campus_ingestion_core.process_raw_ingestion_job`/`submit_raw_ingestion_job` and dumping `ImportReport`.

## Error Handling

**Strategy:** Errors bubble through the specialist or supervisor into the HTTP layer, where `ErrorInfo` shapes the JSON response.

**Patterns:**
- `apps/supervisor-api/src/campus_supervisor_api/api.py` wraps `ApiAuthError` (from `.auth.py`) and returns `error_response` with `ErrorInfo`.
- `packages/rag-specialist/src/campus_rag_specialist/service.py` catches `CorpusQueryDisabledError` and `RetrievalBackendError` from `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`, returning statuses like `error`, `needs_clarification`, or `no_answer`.
- `SupervisorRequest.__post_init__`, `SpecialistRequest.__post_init__`, `RetrievalRequest.__post_init__`, and `CorpusRuntimeProfile` class validators prevent invalid corpora, top_k, or artifact modes from propagating.

## Cross-Cutting Concerns

**Authentication:** `ApiSettings` (`apps/supervisor-api/src/campus_supervisor_api/settings.py`) defines bearer and trusted-worker config; `map_actor_context` either projects a configured default actor in bearer mode or derives caller claims from a trusted worker JWT before building `ActorContext`.

**Configuration:** `ApiSettings` and `RetrievalSettings` (`packages/retrieval-core/src/campus_retrieval_core/settings.py`) read runtime overrides from environment variables, keeping host, embedding provider, and registry URLs adjustable per deployment.

**Validation:** Dataclasses across contracts (`packages/contracts/src/campus_contracts/models.py`), retrieval (`RetrievalRequest`), and ingestion (`CorpusRuntimeProfile`) run `__post_init__` checks so invalid corpora/top_k/artifact mode combinations fail fast.

**Auditing & Trace:** `SupervisorAuditRecord` (`packages/supervisor-core/src/campus_supervisor_core/audit.py`) projects the minimal fields (`request_id`, `trace_id`, `user_id`, `status`, `source_doc_ids`) that `packages/supervisor-core` tracks per request, plus trace IDs are echoed back to clients in `api.py`.

**State & Runtime Profiles:** `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` loads `configs/ingestion/<corpus>/<collection>/runtime-profile.json` to gate query-serving and index bindings, while `var/` now mainly holds local artifacts such as import reports and backups rather than canonical registry truth.
