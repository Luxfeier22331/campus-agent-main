# Codebase Concerns

**Analysis Date:** 2026-03-23

## Tech Debt

**Supervisor coordination is still a pass-through (`packages/supervisor-core/src/campus_supervisor_core/agent.py`, `routing.py`, `response.py`, `policy.py`):**
- Issue: `SupervisorAgent.handle` only builds `SupervisorRequestContext`, enforces the single `QUERY_ENABLED_CORPUS`, delegates straight to `rag-specialist`, and then re-emits the specialist response without any policy layers or request framing.
- Why: Phase‑1 bootstrapping deemed a minimal delegation pipeline sufficient to prove the end-to-end path.
- Impact: Adding new specialists/corpora, customizing clarification policies, or auditing response shaping requires rewriting the entire module because there is no explicit `RequestFraming`, `RoutingPolicy`, or `ResponseAssembler` even though the architecture docs describe them (`docs/architecture/supervisor-architecture.md`).
- Fix approach: Reify the suggested responsibility layers (request framing, intent routing, delegation gateway, response assembler, audit projector) inside `packages/supervisor-core`, ensure `route_request` returns structured decisions rather than raising, and make the specialist list a configurable registry.

**Retrieval backend is re-created on every call (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Issue: `retrieve_sources` either uses the injected backend or instantiates a new `QdrantRetrievalBackend(RetrievalSettings.from_env())`, which itself builds a `DocumentRegistry`, a `QdrantClient`, and an embedding model inside `__post_init__`.
- Why: A quick wiring to get retrieval + specialist working without managing shared lifetimes.
- Impact: Each user query fires two remote handshakes (Postgres registry + Qdrant server) and reinitializes the embedding model before the actual search, so latency and connection churn climb linearly with traffic.
- Fix approach: Hoist backend creation outside the hot path (process-level singleton or dependency-injected pool), and reuse the `EmbeddingSettings`, `DocumentRegistry`, and client for the lifetime of a worker so only the actual search runs per request.

**Specialist answer shaping is a stub (`packages/rag-specialist/src/campus_rag_specialist/agent.py` and `service.py`):**
- Issue: `RagSpecialistAgent.compose_answer` simply emits the first snippet plus a concatenated citation string, and `delegate_to_rag_agent` never enriches or reshapes the evidence bundle beyond calling `derive_confidence`.
- Why: Offer an answer so the supervisor pipeline proves that evidence can flow through.
- Impact: Responses remain raw text snippets without structured reasoning, follow-up prompts, or multimodal composition; flagging new evidence sources or templating (needed for future UX) would require rewriting this minimal logic.
- Fix approach: Extract an answer-shaping layer that can aggregate multiple sources, respect `max_answer_sources`, support structured follow-ups, and plug into `finalize_specialist_response` so the specialist contract can evolve without touching the core agent.

## Known Bugs

**Requesting `curriculum_plan` corpus raises before a response (`packages/supervisor-core/src/campus_supervisor_core/routing.py`):**
- Symptoms: `delegate_to_rag_agent` never runs; `campus_supervisor_core.handle_request` raises `ValueError("phase-1 query-serving only supports student_handbook")` and the request fails with a 500 when the client requests `corpora=("curriculum_plan",)` even though that corpus exists in `packages/contracts/src/campus_contracts/models.py`.
- Trigger: Any request that explicitly sets a non-`student_handbook` corpus, whether coming from new UI layers or ingestion tests.
- Workaround: None—`handle_request` does not wrap the exception.
- Root cause: `route_request` enforces the phase‑1 corpus by raising instead of translating it into a `DelegateToRagAgentResponse` with `ErrorInfo`.
- Fix approach: Move the corpus gating into request framing, return a structured error response (status `error` with code `corpus_not_query_enabled`), and let the API layer surface a proper 400 rather than crashing.

## Security Considerations

**Actor identity is forged via headers (`apps/supervisor-api/src/campus_supervisor_api/auth.py`):**
- Risk: After passing the shared bearer token, any client can spoof `x-actor-id`, `x-actor-roles`, `x-actor-groups`, and `x-campus-scope`; those header values flow straight into `ActorContext` and reach downstream policies with no verification or TTL.
- Current mitigation: A single bearer token gate, but it only proves the caller knows that token; it does not bind actor claims to a trusted issuer.
- Recommendations: Accept actor metadata from a signed token (JWT/HMAC) or drop the client-supplied headers for identity-critical fields, relying on an internal directory or API gateway to supply trusted roles/groups.

**Audit sink is never wired (`packages/supervisor-core/src/campus_supervisor_core/audit.py` and `apps/supervisor-api/src/campus_supervisor_api/app.py`):**
- Risk: Supervisor already projects `SupervisorAuditRecord` (request_id, trace_id, status, doc ids) via `build_audit_record`, but `apps/supervisor-api.create_app` never passes the optional `audit_sink` to `handle_request`, so no audit log is emitted and `ApiSettings.audit_log_path` is unused.
- Current mitigation: None—production deployments have zero persisted audit trail.
- Recommendations: Connect `handle_request` to a sink that persists newline-delimited JSON (or integrates with a logging service) whenever requests complete, honoring `ApiSettings.audit_log_path` for compliance monitoring.

## Performance Bottlenecks

**Backend initialization in the hot path (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Problem: Before any retrieval happens, `retrieve_sources` re-instantiates `QdrantRetrievalBackend`, which in turn rebuilds the `DocumentRegistry`, `QdrantClient`, and embedding model on each call.
- Measurement: Every query triggers at least two remote handshakes (Postgres registry builder + Qdrant HTTP connection) and a fresh embedding-model creation before the Qdrant search even runs, so p95 latency is dominated by backend setup rather than the query proper.
- Cause: Bootstrapping the wiring without managing lifetime for the heavyweight components.
- Improvement path: Cache or inject a warmed backend (and embedding model) per worker so the only per-request work is encoding the query and running `VectorStore.query`.

## Fragile Areas

**Qdrant vector store depends on private APIs (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`):**
- Why fragile: Calls like `_vector_store._detect_vector_format` and checking `_legacy_vector_format` reach into private `llama_index` attributes that can change without notice.
- Common failures: Upgrading `llama_index` or `llama-index-vector-stores-qdrant` may rename/remove `_legacy_vector_format`, breaking startup or query-time metadata detection.
- Safe modification: Wrap the vector store in an adapter that hides the private access, add defensive checks for attribute presence, and lock to a tested version before upgrading.
- Test coverage: Only the backend tests (`tests/retrieval/test_backend_qdrant.py`) run, and they never assert on these private attributes, so a dependency bump would slip by until runtime.

**Silent failures when registry/collection missing (`backend_qdrant.py`):**
- Why fragile: `retrieve` returns an empty `EvidenceBundle` when the collection or registry is absent (`if not self.qdrant_client.collection_exists`/missing nodes) without logging or surfacing the misconfiguration.
- Common failures: New ingestion jobs that did not seed the registry end up producing `no_answer` across the API with no diagnostics.
- Safe modification: Emit logs/metrics when collections or registry rows are absent and consider failing early so callers know ingestion is misaligned.
- Test coverage: Existing tests only cover disabled-corpus or happy paths; there is no coverage for missing collection scenarios, so this silence is hard to detect.

## Scaling Limits

**CLI ingestion worker cannot keep up with volume (`apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` and `packages/ingestion-core/src/campus_ingestion_core/process.py`):**
- Current capacity: Each run of `process_raw_ingestion_job()` handles a single job synchronously (OCR + chunking + index writes).
- Limit: Throughput capped at 1 job/worker at a time, so ingestion throughput cannot exceed the wall-clock time of a single job (minutes for OCR-heavy documents).
- Symptoms at limit: New content piles up until someone manually re-runs the script; failures leave no automatic retry.
- Scaling path: Introduce a job queue/worker scheduler so multiple ingestion workers can pull jobs, orchestrate retries, and backpressure the OCR stage.

## Dependencies at Risk

**`llama_index` private API (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` and `packages/ingestion-core/src/campus_ingestion_core/process.py`):**
- Risk: Both ingestion and retrieval rely on internal `llama_index` structures (`QdrantVectorStore`, `_detect_vector_format`, `_legacy_vector_format`, `TextNode`, etc.) that are not semver-guaranteed.
- Impact: Any `llama_index` release that reorganizes core modules will break both ingestion indexing and runtime retrieval, causing the entire RAG pipeline to fail.
- Migration plan: Encapsulate `llama_index` usage behind adapters, pin the working versions, and add regression tests that run with new `llama_index` releases in a controlled environment before upgrading.

**`qdrant-client` without retries (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`):**
- Risk: Requests to Qdrant are issued with the default client and no retry/backoff logic, so transient network glitches surface directly as `RetrievalBackendError`.
- Impact: Any hiccup in the Qdrant cluster turns into error responses; there is no circuit breaker or fallback cache.
- Migration plan: Wrap `QdrantClient` in a resilient client (retry/backoff, optional circuit breaker) or memoize results for short bursts so downstream errors are contained.

## Missing Critical Features

**Audit/log sink is not hooked (`packages/supervisor-core/src/campus_supervisor_core/audit.py`, `apps/supervisor-api/src/campus_supervisor_api/app.py`):**
- Problem: Although `handle_request` allows an `audit_sink`, `apps/supervisor-api.create_app` never wires one, so the audit log path from `ApiSettings.audit_log_path` is untouched and there is no persisted trace of request_id/trace_id/status combinations.
- Current workaround: None; the only audit evidence exists inside unit tests.
- Blocks: Compliance/ops teams cannot trace which corpus produced which response, making debugging or incident post-mortems difficult.
- Implementation complexity: Low—implement a sink that appends newline-delimited JSON to `ApiSettings.audit_log_path` (or injects into structured logging) and pass it down to `handle_request`.

**Ingestion orchestration and monitoring (`packages/ingestion-core/src/campus_ingestion_core` & `apps/ingestion-worker`) still manual:**
- Problem: There is no scheduler, queue, or observability for ingestion jobs described in `docs/plans/agentic-rag-foundation.md`; helpers such as `submit_raw_ingestion_job` and `process_raw_ingestion_job` only work with CLI env vars and print JSON reports.
- Current workaround: Engineers run these scripts manually and inspect stdout, so ingestion is not production-grade.
- Blocks: Automating new corpora uploads, scaling with multiple campuses, or recovering from ingestion failures.
- Implementation complexity: Medium—add a job registry table/queue, expose a structured ingestion API, and plug in monitoring/alerts.

## Test Coverage Gaps

**`apps/supervisor-api` lacks targeted tests:**
- What's not tested: `build_routes`, `handle_answer`, `map_actor_context`, authorization failure modes, and the `SupervisorApiApp.handle` fallback behavior.
- Risk: Authentication bugs or route regressions would reach production undetected.
- Priority: High.
- Difficulty to test: Low—existing workspace layout test already imports `campus_supervisor_api.create_app`; extend it with requests that exercise bad tokens, missing routes, and audit sink wiring.

**`packages/ingestion-core` pipeline has no unit/integration tests:**
- What's not tested: `index_chunks_to_qdrant`, `process_raw_ingestion_job`, object-store interactions, and the chunking/embedding helpers.
- Risk: Any regression in chunking, registry writes, or object-store key generation will surface only during manual runs.
- Priority: Medium.
- Difficulty to test: Medium; existing mock helpers in `campus_ingestion_core` can be leveraged to build reproducible pipelines.

**`campus_retrieval_core.service.retrieve_sources` default path is untested:**
- What's not tested: the environment-backed path that builds `QdrantRetrievalBackend` inside `retrieve_sources`, so env parsing and error mapping in the default flow is not covered.
- Risk: Regression when wiring backend creation through DI would go unnoticed (e.g., missing env variable causes `ValueError` before `campus_rag_specialist` runs).
- Priority: Medium.
- Difficulty to test: Medium; add an integration test that sets `QDRANT_URL=:memory:` and exercises `retrieve_sources()` without injecting `backend`.

*Concerns audit: 2026-03-23*
*Update as issues are fixed or new ones discovered*
