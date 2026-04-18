# Phase 4: RAG Specialist Answer Path - Context

**Gathered:** 2026-03-27
**Status:** Implemented and verified
**Source:** Refreshed from roadmap, requirements, current retrieval/rag code, ADR-0007 retrieval baseline, and the current phase-1 implementation truth; status updated after plan execution

<domain>
## Phase Boundary

Phase 4 closes `QRY-01` through `QRY-04` for `student_handbook`. The scope is to make `rag-specialist` return grounded answers, citations, clarification responses, and safe `no_answer` / `error` outcomes on top of the already accepted phase-1 retrieval baseline and the generalized specialist boundary frozen by Phase 03.1.

The phase does not expand supervisor scope, does not reopen shared contract generalization beyond the baseline already frozen before it, and does not broaden query-serving beyond `regulations/student_handbook`.

The phase delivers four things:

- `rag-specialist` can turn handbook evidence into grounded answer responses.
- successful responses include chunk-traceable source identifiers.
- ambiguous or referentially incomplete requests return `needs_clarification` instead of guessed answers.
- retrieval failure or insufficient evidence returns `no_answer` or `error` with safe response shaping.

</domain>

<decisions>
## Implementation Decisions

### Locked by roadmap, requirements, and prior phases
- Phase 4 addresses `QRY-01`, `QRY-02`, `QRY-03`, and `QRY-04` only.
- `supervisor-core` remains a policy-driven coordinator and does not absorb retrieval strategy, query rewriting, or evidence collection logic.
- `rag-specialist` remains the only phase-1 query-serving specialist.
- Query-serving remains restricted to `regulations/student_handbook`.
- The accepted retrieval baseline is no longer a phase-4 gray area. It is already fixed as `dense + sparse + RRF + registry-backed evidence shaping`.
- Retrieval-side metadata pre-filter is already mandatory before candidate fusion: `corpus`, `collection`, `revision_track`, `status`, `is_current` when required, ACL, and `campus_scope`.

### Retrieval posture Phase 4 must consume, not redesign
- `packages/retrieval-core` already owns Qdrant native hybrid retrieval and registry back-link.
- Phase 4 must treat `dense + sparse + RRF + registry-backed EvidenceBundle` as upstream input, not as a pending design topic.
- `HyDE`, rerank, multi-query decomposition, and default-on query expansion are not part of the current baseline.
- Phase 4 may add specialist-side retrieval framing and evidence packaging, but it must not re-open retrieval-core into a second strategy stack.

### Query handling posture
- Query rewrite may exist in Phase 4 only as a conservative, specialist-local rewrite toward standalone searchability.
- Rewrite must preserve user intent, must not introduce facts, and must remain single-query by default.
- Multi-turn handling stays fail-closed in phase-1:
  - current contract keeps `conversation_id` only
  - phase-1 does not add full history payload or implicit conversation reconstruction
  - obvious referential follow-up queries should return `needs_clarification`
- Clarification policy should stay relatively proactive:
  - if the query lacks the concrete subject, regulation target, or referent needed for reliable handbook retrieval, `rag-specialist` should ask for clarification rather than guess

### Evidence packaging and answer posture
- Answer composition may synthesize from more than one evidence chunk; it is not limited to replaying the lead snippet verbatim.
- Phase-1 answer composition should use at most 3 evidence items by default.
- Evidence ordering should prefer:
  - de-duplication first
  - then relevance
  - then source diversity, so the answer does not overfit a cluster of adjacent chunks from one source
- Citation granularity remains chunk-level in phase-1. Do not collapse citations to document-only identifiers.
- Confidence should be derived from evidence support quality, not only top-1 vector score.

### Table evidence posture
- Already locked by Phase 3 and current ingestion behavior:
  - `table` and `table_row` remain independent evidence units
  - parent prose chunks strip embedded HTML table bodies and replace them with a placeholder
  - retrieval returns chunk text as `EvidenceSource.snippet`
- Current implementation truth:
  - document-unit rows preserve `html` for provenance
  - document-unit rows preserve `table_cells` as structured table truth
  - `table_row.clean_text` is currently projected as structured plain text like `列名=值 | 列名=值`
- Phase 4 should treat prompt-facing table formatting as answer-time consumption work first.
- Phase 4 should not reopen ingestion/chunk projection unless answer-time formatting proves insufficient.

### The agent's discretion
- Exact decomposition between rewrite logic, clarification checks, evidence ranking, answer assembly, and confidence derivation within `packages/rag-specialist`, as long as package boundaries remain intact.
- Whether answer composition uses one or more intermediate internal representations before returning the accepted response contract.
- The exact unit/integration/eval split, as long as `completed`, `needs_clarification`, `no_answer`, and `error` branches are each asserted directly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and milestone guardrails
- `AGENTS.md`
- `README.md`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/phases/01-contract-and-boundary-guardrails/01-CONTEXT.md`
- `.planning/phases/03-retrieval-corpus-preparation/03-CONTEXT.md`
- `.planning/phases/03.1-availability-specialist/03.1-CONTEXT.md`
- `.planning/phases/03.2-source-truth-fan-out-and-attachment-projection/03.2-CONTEXT.md`

### Architecture and retrieval truth
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/architecture/target-architecture.md`
- `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md`
- `docs/reference/phase1-ingestion-retrieval-implementation-truth.md`

### Existing code surfaces
- `packages/contracts/src/campus_contracts/models.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `packages/rag-specialist/src/campus_rag_specialist/confidence.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`

### Test surfaces
- `tests/specialist/test_rag_specialist.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/evals/test_golden_cases.py`
- `tests/ingestion/test_handbook_cleanup.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- `tests/ingestion/test_processing_pipeline.py`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `delegate_to_rag_agent()` already owns the specialist-side control flow, so rewrite, clarification checks, evidence ranking, and answer assembly should extend this surface instead of creating a parallel entrypoint.
- `retrieve_sources()` already gives `rag-specialist` a typed `EvidenceBundle` abstraction and hides Qdrant details.
- `QdrantRetrievalBackend.retrieve()` already executes Qdrant native `dense + sparse + RRF` and returns registry-backed evidence.
- `RagSpecialistAgent.compose_answer()` is currently intentionally minimal and can be replaced by a grounded multi-evidence assembler without touching supervisor boundaries.

### Current implementation gaps
- `delegate_to_rag_agent()` currently maps blank goals, retrieval errors, and empty evidence, but it does not yet implement proactive clarification for ambiguous handbook questions.
- `RagSpecialistAgent.compose_answer()` currently just returns the lead snippet plus inline `doc_id#chunk_id` citations; it does not yet perform grounded multi-evidence synthesis.
- `derive_confidence()` currently relies on source count and top score only; it does not yet reason about evidence diversity, consistency, or citation quality.
- Phase 4 still lacks dedicated plan/research artifacts that reflect the post-ADR-0007 hybrid retrieval truth.

### Established patterns
- Contract-only handoff is already locked. Phase 4 should consume the generalized specialist boundary frozen by earlier work instead of inventing a new bypass.
- Retrieval currently returns snippet-first evidence, not final prompt-ready answer blocks. Phase 4 should explicitly define the packaging step instead of assuming retrieval output is final-answer-ready.
- Runtime truth is repo-tracked. If answer behavior becomes stable cross-phase truth, update docs/tests rather than hiding it only in code.

### Integration points
- `packages/rag-specialist` is the natural home for conservative standalone-query rewrite, clarification heuristics, evidence packaging, and answer composition.
- `packages/retrieval-core` should remain the owner of candidate retrieval, metadata filtering, fusion, and registry back-link.
- Table evidence consumption can be improved in specialist answer assembly without reopening ingestion/chunking in this phase.

</code_context>

<specifics>
## Specific Ideas

- Start Phase 4 planning from the fact that the repo already has a typed path for `completed`, `needs_clarification`, `no_answer`, and `error`; the work is to make those branches semantically correct and evidence-grounded.
- Treat conservative rewrite plus proactive clarification as the default safety posture.
- Keep answer composition small-context by default:
  - up to 3 evidence chunks
  - explicit chunk citations
  - de-duplicate before composing
- Record table-evidence consumption as an explicit answer-time design item in the plan instead of letting it emerge accidentally from current snippet text.

</specifics>

<deferred>
## Deferred Ideas

- Full conversation memory or durable history-aware retrieval
- Implicit multi-turn contextualization based on hidden conversation reconstruction
- `HyDE`
- rerank
- multi-query decomposition
- default-on query expansion
- supervisor-side rewrite, ranking, or answer synthesis

</deferred>

---

*Phase: 04-rag-specialist-answer-path*
*Context refreshed: 2026-03-27 via roadmap + retrieval baseline ADR + current code audit*
*Execution status updated: 2026-03-27 after 04-01 / 04-02 / 04-03 verification passed*
