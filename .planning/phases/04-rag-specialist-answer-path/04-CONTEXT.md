# Phase 4: RAG Specialist Answer Path - Context

**Gathered:** 2026-03-24
**Status:** Discussion in progress
**Source:** Derived from roadmap, prior phase context, architecture docs, current `rag-specialist` / `retrieval-core` code, and discussion decisions recorded on 2026-03-24

<domain>
## Phase Boundary

Phase 4 closes `QRY-01` through `QRY-04` for `student_handbook`. The scope is to make `rag-specialist` return grounded answers, citations, clarification responses, and safe no-answer/error outcomes on top of the Phase 3 retrieval-ready evidence path.

The phase does not expand supervisor scope, does not redesign the shared handoff contract by default, and does not broaden query-serving beyond `regulations/student_handbook`.

The phase delivers four things:

- `rag-specialist` can turn `student_handbook` evidence into grounded answer responses.
- successful responses include source identifiers that remain traceable to chunk-level evidence.
- ambiguous requests return `needs_clarification` instead of guessed answers.
- retrieval failure or insufficient evidence returns `no_answer` or `error` with safe response shaping.

</domain>

<decisions>
## Implementation Decisions

### Locked by roadmap, requirements, and prior phases
- Phase 4 addresses `QRY-01`, `QRY-02`, `QRY-03`, and `QRY-04` only.
- `supervisor-core` remains a policy-driven coordinator and does not absorb retrieval strategy, query rewriting, or evidence collection logic.
- `rag-specialist` remains the only phase-1 query-serving specialist.
- Query-serving remains restricted to `regulations/student_handbook`.
- Phase 3 retrieval truth is now upstream input, not a design variable for this phase: retrieval-ready evidence already comes from registry-backed `document-units.jsonl` chunking and Qdrant payloads.

### Query handling decisions confirmed in discussion
- Phase 4 will enable query rewriting, but only as retrieval-oriented rewrite inside `packages/rag-specialist`.
- `supervisor` does not participate in query rewrite, expansion, or retrieval strategy selection.
- Rewrite should stay conservative in phase-1:
  - rewrite toward standalone searchability and handbook retrieval context
  - preserve original user intent
  - do not introduce new facts
  - do not start with multi-query expansion as the default path
- Multi-turn handling stays fail-closed in phase-1:
  - current contract keeps `conversation_id` only
  - phase-1 does not add full history payload or implicit conversation reconstruction by default
  - obvious referential follow-up queries should return `needs_clarification` instead of silent contextual guesswork
- Clarification policy should be relatively proactive:
  - if the query lacks the concrete subject, regulation target, or referent needed for reliable handbook retrieval, `rag-specialist` should ask for clarification rather than guess

### Evidence packaging decisions confirmed in discussion
- Answer composition may synthesize from more than one evidence chunk; it is not limited to replaying the lead snippet verbatim.
- Phase-1 answer composition should use at most 3 evidence items by default, matching the current small-context posture.
- Evidence ordering should prefer:
  - de-duplication first
  - then relevance
  - then source diversity so the answer does not overfit a cluster of adjacent chunks from one source when broader support exists
- Citation granularity remains chunk-level in phase-1. Do not collapse citations to document-only identifiers.

### Table evidence: locked truths vs pending decisions
- Already locked by Phase 3 and current ingestion behavior:
  - `table` and `table_row` remain independent evidence units
  - parent prose chunks strip embedded HTML table bodies and replace them with a placeholder
  - retrieval returns chunk text as `EvidenceSource.snippet`
- Current implementation truth:
  - document-unit rows preserve `html` for provenance
  - document-unit rows preserve `table_cells` as structured table truth
  - `table_row.clean_text` is currently projected as structured plain text like `列名=值 | 列名=值`
  - retrieval snippets are therefore not currently Markdown tables by default
- Pending discussion:
  - whether `table` unit prompt-facing projection should become Markdown-formatted table text
  - whether `table_row` should stay in `key=value` text form for factual lookup
  - whether table projection changes belong only to answer-time consumption or should also change ingestion/chunk projection

### Retrieval strategy: pending discussion
- Current code path is dense retrieval over Qdrant-backed evidence.
- No BM25, RRF, HyDE, or multi-query expansion is currently part of the default path.
- Best-practice review indicates these are valid research topics, but they are not yet locked as phase-1 defaults.
- Pending discussion:
  - whether phase-1 should remain dense-only for the default answer path
  - whether hybrid retrieval belongs in Phase 4 planning or should be recorded as follow-on research

### The agent's Discretion
- Exact decomposition between rewrite logic, clarification checks, evidence ranking, and answer assembly helpers within `packages/rag-specialist`, as long as package boundaries remain intact.
- Whether answer composition uses one or more intermediate internal representations before returning `DelegateToRagAgentResponse`.
- The exact unit/integration test split, as long as completed, clarification, no-answer, and error branches are each asserted directly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and milestone guardrails
- `AGENTS.md` — monorepo architecture constraints, verification rules, and phase boundary guardrails
- `README.md` — current repo status after Phase 3 completion
- `.planning/PROJECT.md` — phase-1 scope, non-goals, and current active requirements
- `.planning/REQUIREMENTS.md` — `QRY-01` to `QRY-04` mapping for Phase 4
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, and plan inventory
- `.planning/STATE.md` — current milestone position after Phase 3 completion
- `.planning/phases/01-contract-and-boundary-guardrails/01-CONTEXT.md` — contract-only handoff and query-scope rules that Phase 4 must preserve
- `.planning/phases/03-retrieval-corpus-preparation/03-CONTEXT.md` — retrieval-ready chunk and evidence metadata truths that Phase 4 consumes

### Architecture and package-boundary truth
- `docs/architecture/long-term-architecture.md` — ownership of query rewriting and retrieval strategy on the specialist side
- `docs/architecture/supervisor-architecture.md` — supervisor responsibilities, non-responsibilities, and conversation framing limits
- `docs/architecture/phase1-ingestion-and-storage-architecture.md` — phase-1 data-plane boundaries and evidence traceability rules
- `docs/architecture/student-handbook-ocr-normalization-strategy.md` — handbook-specific document and table unit semantics
- `docs/decisions/adr-0001-phase1-architecture.md` — accepted phase-1 architecture and scope constraints
- `docs/plans/agentic-rag-foundation.md` — phase-1 completion framing and implementation ordering

### Existing code surfaces
- `packages/contracts/src/campus_contracts/models.py` — current request/response and evidence contract, including `conversation_id` without full message history
- `packages/rag-specialist/src/campus_rag_specialist/service.py` — current bootstrap answer path and specialist entrypoint
- `packages/rag-specialist/src/campus_rag_specialist/agent.py` — current answer composition surface
- `packages/rag-specialist/src/campus_rag_specialist/confidence.py` — current confidence derivation
- `packages/retrieval-core/src/campus_retrieval_core/service.py` — retrieval entrypoint consumed by `rag-specialist`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` — current dense retrieval path and evidence shaping
- `packages/supervisor-core/src/campus_supervisor_core/agent.py` — supervisor orchestration pipeline that Phase 4 must fit without boundary regression

### Test surfaces
- `tests/specialist/test_rag_specialist.py` — current specialist happy-path, no-answer, and error mapping tests
- `tests/retrieval/test_backend_qdrant.py` — retrieval evidence payload expectations
- `tests/evals/test_golden_cases.py` — early golden-case shape for grounded responses
- `tests/ingestion/test_handbook_cleanup.py` — current table-row text projection semantics
- `tests/ingestion/test_handbook_chunking_pipeline.py` — table/table_row evidence-unit expectations
- `tests/ingestion/test_processing_pipeline.py` — parent prose placeholder behavior for embedded tables

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `delegate_to_rag_agent()` already owns the specialist-side control flow, so query rewrite, clarification checks, evidence ranking, and answer assembly should extend this surface instead of creating a parallel entrypoint.
- `retrieve_sources()` already gives `rag-specialist` a typed evidence bundle abstraction and hides Qdrant/LlamaIndex details.
- `QdrantRetrievalBackend.retrieve()` already shapes chunk text into `EvidenceSource.snippet`, making snippet ordering and answer packaging a specialist concern, not a retrieval-core responsibility.
- `RagSpecialistAgent.compose_answer()` is currently intentionally simple and can be replaced by a more grounded multi-evidence assembler without touching supervisor boundaries.

### Established Patterns
- Contract-only handoff is already locked by Phase 1. Do not add a second specialist API shape.
- Runtime truth is repo-tracked. If table projection or retrieval defaults become stable cross-phase truth, update the right docs/configs instead of hiding them only in code.
- Clarification, no-answer, and error are already first-class response statuses in the shared contract.
- Retrieval currently returns snippet-first evidence, not prompt-ready context blocks. Phase 4 should explicitly define the packaging step instead of assuming retrieval output is final-answer-ready.

### Integration Points
- `packages/rag-specialist` is the natural home for conservative standalone-query rewrite and clarification heuristics.
- `packages/retrieval-core` may remain dense-only in the initial phase-1 implementation unless Phase 4 planning explicitly chooses a broader retrieval strategy.
- Table projection work may span ingestion-time chunk text and specialist-time answer consumption; the phase plan must decide which layer owns prompt-facing formatting.

</code_context>

<specifics>
## Specific Ideas

- Start Phase 4 planning from the fact that the repo already has a working typed path for `completed`, `needs_clarification`, `no_answer`, and `error`; the work is to make those branches semantically correct and evidence-grounded.
- Treat conservative query rewrite and proactive clarification as the default phase-1 safety posture.
- Keep answer composition small-context by default:
  - up to 3 evidence chunks
  - explicit chunk citations
  - de-duplicate before composing
- Record table-evidence projection as an explicit design item in the plan instead of letting it emerge accidentally from current snippet text.

</specifics>

<deferred>
## Deferred Ideas

- Full conversation memory or durable history-aware retrieval
- Implicit multi-turn contextualization based on hidden conversation reconstruction
- Multi-query expansion as the default retrieval path
- BM25/RRF/HyDE as locked phase-1 defaults before explicit Phase 4 research and eval justification
- Supervisor-side rewrite, ranking, or answer synthesis that would blur package boundaries

</deferred>

---

*Phase: 04-rag-specialist-answer-path*
*Context gathered: 2026-03-24 via roadmap + architecture docs + current code audit + discussion notes*
