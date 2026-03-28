# Codebase Concerns

**Analysis Date:** 2026-03-29

## Tech Debt

**Supervisor coordination is still a thin coordinator (`packages/supervisor-core/src/campus_supervisor_core/agent.py`, `routing.py`, `response.py`, `policy.py`):**
- Issue: `SupervisorAgent.handle` now builds `SupervisorRequestContext`, routes through an explicit decision, frames `SpecialistRequest`, delegates, and reassembles the result, but it still remains a narrow policy shell with little intent shaping or multi-step planning.
- Why: The repo intentionally stopped at a minimal supervisor-led boundary once typed routing, query-policy, and audit hooks were in place.
- Impact: Adding richer clarification policies, multi-specialist orchestration, or answer post-processing will still require substantial supervisor expansion because the current implementation is intentionally shallow.
- Fix approach: Introduce richer request framing and response-finalization layers only when a concrete second-step coordination need appears; avoid re-flattening the boundary back into API-shell or specialist-local logic.

**Retrieval backend lifecycle is still implicit (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Issue: `retrieve_sources` still constructs a backend on demand unless callers explicitly inject one, but there is no runtime-owned lifecycle or warmup boundary.
- Why: The code keeps the retrieval service simple and fail-closed instead of introducing a host-level dependency container.
- Impact: Requests still pay backend initialization cost unless a higher layer starts managing backend reuse explicitly.
- Fix approach: Hoist backend creation into runtime startup if serving volume or cold-start latency justifies a more explicit dependency lifecycle.

**Specialist answer shaping is still intentionally simple (`packages/rag-specialist/src/campus_rag_specialist/agent.py` and `service.py`):**
- Issue: `RagSpecialistAgent.compose_answer` now selects supporting evidence and renders a grounded answer template, but it is still a deterministic text renderer rather than a richer structured answer layer.
- Why: The repo froze a small grounded-answer baseline before introducing richer orchestration or post-processing.
- Impact: Future needs such as answer sectioning, richer clarification follow-ups, or UI-targeted structured rendering will still require a dedicated answer-shaping layer.
- Fix approach: Extract a more explicit answer assembly component once product surfaces need richer response structure than the current grounded template.

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

**Backend lifecycle is per-call unless injected (`packages/retrieval-core/src/campus_retrieval_core/service.py`):**
- Problem: the default `retrieve_sources()` path creates a backend on demand rather than participating in an explicit app-owned dependency lifecycle.
- Measurement: callers that do not inject a backend pay the full registry/Qdrant/embedding startup path repeatedly.
- Cause: The code intentionally kept retrieval bootstrap simple instead of adding a broader DI container.
- Improvement path: If retrieval traffic grows, move backend creation into runtime startup and make the lifecycle explicit per host process.

## Fragile Areas

**Retrieval payload shape is tightly coupled to ingestion output (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`):**
- Why fragile: `_record_to_text_node(...)` and evidence shaping assume a stable payload contract (`node_content`, `text`/`display_text`, document metadata, anchors) emitted by ingestion/indexing.
- Common failures: Changing chunk payload fields or node serialization in ingestion can silently degrade retrieval shaping, title extraction, or registry back-link behavior.
- Safe modification: Version payload changes explicitly, add cross-package regression tests, and keep retrieval payload parsing narrow and well asserted.
- Test coverage: Backend tests cover many shaping paths, but payload contract drift can still slip through if ingestion changes field semantics without updating retrieval assertions.

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

**`llama_index` schema and adapter surface (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` and `packages/ingestion-core/src/campus_ingestion_core/process.py`):**
- Risk: Ingestion and retrieval both depend on `llama_index` data models such as `TextNode` and adapter behavior across indexing/query paths.
- Impact: Dependency upgrades that change serialization or adapter semantics can break chunk persistence or retrieval parsing even without any repo-level code changes.
- Migration plan: Pin working versions, keep adapter usage narrow, and add regression tests that exercise both indexing output and retrieval parsing before upgrades.

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

*Concerns audit: 2026-03-29*
*Update as issues are fixed or new ones discovered*
