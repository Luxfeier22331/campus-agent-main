# Codebase Concerns

**Analysis Date:** 2026-03-28

## Tech Debt

**Supervisor coordination is still a thin coordinator (`packages/supervisor-core/src/campus_supervisor_core/agent.py`, `routing.py`, `response.py`, `policy.py`):**
- Issue: `SupervisorAgent.handle` now builds `SupervisorRequestContext`, routes through an explicit decision, frames `SpecialistRequest`, delegates, and reassembles the result, but it still remains a narrow policy shell with little intent shaping or multi-step planning.
- Why: The repo intentionally stopped at a minimal supervisor-led boundary once typed routing, query-policy, and audit hooks were in place.
- Impact: Adding richer clarification policies, multi-specialist orchestration, or answer post-processing will still require substantial supervisor expansion because the current implementation is intentionally shallow.
- Fix approach: Introduce richer request framing and response-finalization layers only when a concrete second-step coordination need appears; avoid re-flattening the boundary back into API-shell or specialist-local logic.

**Retrieval backend lifecycle is still implicit (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Issue: `retrieve_sources` now uses a process-local backend cache, but the cache remains an internal module detail rather than an explicit runtime-owned dependency lifecycle.
- Why: The code moved from full per-request reinitialization to a small fail-closed cache without introducing a larger host-level container.
- Impact: New worker processes still pay backend startup cost on first request, and the ownership boundary for backend warmup/teardown is still implicit.
- Fix approach: Hoist backend creation into runtime startup if serving volume or cold-start latency justifies a more explicit dependency lifecycle.

**Specialist answer shaping is a stub (`packages/rag-specialist/src/campus_rag_specialist/agent.py` and `service.py`):**
- Issue: `RagSpecialistAgent.compose_answer` simply emits the first snippet plus a concatenated citation string, and `delegate_to_rag_agent` never enriches or reshapes the evidence bundle beyond calling `derive_confidence`.
- Why: Offer an answer so the supervisor pipeline proves that evidence can flow through.
- Impact: Responses remain raw text snippets without structured reasoning, follow-up prompts, or multimodal composition; flagging new evidence sources or templating (needed for future UX) would require rewriting this minimal logic.
- Fix approach: Extract an answer-shaping layer that can aggregate multiple sources, respect `max_answer_sources`, support structured follow-ups, and plug into `finalize_specialist_response` so the specialist contract can evolve without touching the core agent.

## Known Bugs

No current query-scope crash is recorded here: the old `student_handbook`-only routing bug has been removed, and query-serving scope is now enforced through runtime-profile-backed supervisor policy with structured fail-closed errors.

## Security Considerations

**Bearer mode still represents a coarse caller class (`apps/supervisor-api/src/campus_supervisor_api/auth.py`):**
- Risk: Bearer mode no longer trusts caller-supplied actor headers, but it still projects one configured default actor for every request that holds the shared token.
- Current mitigation: `trusted-worker` mode derives caller identity from the forwarded Access JWT, and bearer mode is now explicit about its coarse identity posture.
- Recommendations: Use `trusted-worker` or another signed-identity mode for any deployment that needs per-user enforcement rather than a shared caller class.

**Audit persistence is local-file-first (`apps/supervisor-api/src/campus_supervisor_api/api.py`):**
- Risk: Audit sink wiring now exists, but it currently persists JSONL to the local audit path by default rather than a centralized durable observability pipeline.
- Current mitigation: The API shell fail-closes if the configured audit sink cannot be written.
- Recommendations: Promote audit output to a managed log pipeline or durable store before production-scale traffic so request history is not tied to one host filesystem.

## Performance Bottlenecks

**Backend cache is process-local only (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Problem: `retrieve_sources` now caches initialized backends, but the cache is an in-process dictionary keyed by settings rather than a more explicit lifecycle-managed dependency graph.
- Measurement: Warm requests avoid reinitialization, but every new worker process still pays the full registry/Qdrant/embedding startup cost once.
- Cause: The code intentionally stopped at a small fail-closed cache instead of introducing a broader app-wide DI container.
- Improvement path: If retrieval traffic grows, move backend creation into runtime startup and make the lifecycle explicit per host process.

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

**Audit/log pipeline stops at JSONL (`packages/supervisor-core/src/campus_supervisor_core/audit.py`, `apps/supervisor-api/src/campus_supervisor_api/api.py`):**
- Problem: The API shell now writes audit records, but only to the configured local JSONL sink.
- Current workaround: Consume the JSONL file directly during local verification and debugging.
- Blocks: Centralized compliance monitoring, retention policy management, and cross-host audit search.
- Implementation complexity: Low to medium—replace or wrap the current sink with structured log shipping or a managed audit store.

**Ingestion orchestration and monitoring (`packages/ingestion-core/src/campus_ingestion_core` & `apps/ingestion-worker`) still manual:**
- Problem: There is no scheduler, queue, or observability for ingestion jobs described in `docs/plans/agentic-rag-foundation.md`; helpers such as `submit_raw_ingestion_job` and `process_raw_ingestion_job` only work with CLI env vars and print JSON reports.
- Current workaround: Engineers run these scripts manually and inspect stdout, so ingestion is not production-grade.
- Blocks: Automating new corpora uploads, scaling with multiple campuses, or recovering from ingestion failures.
- Implementation complexity: Medium—add a job registry table/queue, expose a structured ingestion API, and plug in monitoring/alerts.

## Test Coverage Gaps

**`apps/supervisor-api` test surface still skews toward route-level behavior:**
- What's not fully stressed: broader runtime-host permutations, log sink failure handling across deployment environments, and more exhaustive auth-mode matrix coverage beyond the current API tests.
- Risk: Host-specific regressions or environment-specific auth/audit integration issues may slip through even though the core API path is covered.
- Priority: Medium.
- Difficulty to test: Medium; extend `tests/api/test_supervisor_api.py` with more environment-mode and sink-failure cases.

**`packages/ingestion-core` still relies heavily on mocked integration coverage:**
- What's not fully stressed: remote object-store, remote Qdrant, and live OCR interactions under realistic failure modes; most current tests validate logic with in-memory or patched adapters.
- Risk: Infrastructure-specific regressions can still surface only during live rebuilds or shared-dev runs.
- Priority: Medium.
- Difficulty to test: Medium; add more live-contract smoke cases around cloud Qdrant/object-store interactions without making the main test suite flaky.

**`campus_retrieval_core.service.retrieve_sources` default path is untested:**
- What's not tested: the environment-backed path that builds `QdrantRetrievalBackend` inside `retrieve_sources`, so env parsing and error mapping in the default flow is not covered.
- Risk: Regression when wiring backend creation through DI would go unnoticed (e.g., missing env variable causes `ValueError` before `campus_rag_specialist` runs).
- Priority: Medium.
- Difficulty to test: Medium; add an integration test that sets `QDRANT_URL=:memory:` and exercises `retrieve_sources()` without injecting `backend`.

*Concerns audit: 2026-03-28*
*Update as issues are fixed or new ones discovered*
