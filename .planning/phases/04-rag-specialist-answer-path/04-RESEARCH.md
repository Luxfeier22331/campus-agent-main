# Phase 4: RAG Specialist Answer Path - Research

**Researched:** 2026-03-27
**Domain:** `student_handbook` grounded answer path on top of the accepted hybrid retrieval baseline
**Confidence:** HIGH
**Execution Status:** Applied and verified on 2026-03-27

## Executive Summary

Phase 4 no longer needs to research whether phase-1 should stay dense-only. That question is already closed by current repo truth.

The accepted upstream baseline is:

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: `Qdrant native BM25`
- fusion: `RRF`
- output: registry-backed `EvidenceBundle`

The actual phase-4 problem is now narrower and cleaner:

- consume the already-implemented hybrid retrieval path inside `rag-specialist`
- decide when to clarify instead of retrieving or guessing
- assemble grounded `completed` answers from small evidence sets
- keep `no_answer` and `error` boundaries safe and testable

This means Phase 4 should be planned as specialist-side answer-path closure, not as another retrieval architecture phase.

## Current State Findings

### What is already aligned

- `packages/retrieval-core` already executes Qdrant native hybrid retrieval with `prefetch(dense) + prefetch(sparse) + FusionQuery(RRF)`.
- Retrieval already applies fail-closed metadata filtering for corpus, collection, status, currentness, ACL, and `campus_scope`.
- Retrieval already shapes final sources as registry-backed `EvidenceSource` / `EvidenceBundle`.
- `delegate_to_rag_agent()` already owns the specialist-side terminal branch mapping for:
  - retrieval backend error
  - corpus query disabled
  - empty evidence => `no_answer`
  - non-empty evidence => `completed`
- Current tests already cover the bootstrap branch mapping and retriever wiring.

### What is still incomplete

1. **Clarification semantics are missing**
   - The current code only rejects blank goals.
   - It does not yet distinguish ambiguous handbook questions from answerable ones.

2. **Answer assembly is still bootstrap-level**
   - `compose_answer()` currently emits the lead snippet plus inline citations.
   - It does not yet synthesize across multiple evidence chunks or normalize answer shape.

3. **Confidence is still too shallow**
   - `derive_confidence()` uses top score and source count only.
   - It does not yet account for evidence diversity, agreement, or support quality.

4. **Phase 4 artifacts are stale**
   - `04-CONTEXT.md` previously carried dense-only assumptions.
   - The phase needed a refreshed context/research input before planning.

## Recommended Phase Shape

### Plan 04-01: Retrieval framing and clarification gate inside `rag-specialist`

Focus:

- keep using `retrieve_sources()` as the only retrieval entrypoint
- add specialist-local query preprocessing / conservative rewrite when needed
- add proactive clarification heuristics before or around retrieval
- define what question shapes should fail to `needs_clarification`

This plan should not:

- redesign retrieval-core
- add rerank / HyDE / multi-query
- reopen sparse model choice

### Plan 04-02: Grounded answer assembly, citations, and confidence

Focus:

- replace the current lead-snippet output with grounded multi-evidence answer assembly
- preserve chunk-level citation traceability
- keep the default evidence budget small
- upgrade confidence from score-only to support-aware confidence

This plan should also decide the prompt-facing treatment of table evidence, but only at answer time.

### Plan 04-03: Safe terminal branches and regression/eval closure

Focus:

- implement consistent `needs_clarification`, `no_answer`, and `error` behavior
- add focused specialist tests and golden/eval slices
- prove the phase-1 answer path is safe under insufficient or conflicting support

This plan should be the place where no-hit behavior, low-support behavior, and clarification behavior are locked by tests.

## Recommended Defaults

### Clarification

- Be proactive rather than permissive.
- If the question is obviously referential, missing the target rule/object, or too elliptical to search reliably, return `needs_clarification`.
- Do not silently infer hidden conversation context from `conversation_id`.

### Rewrite

- Allow conservative standalone-query rewrite inside `rag-specialist`.
- Keep rewrite single-query and reversible in spirit.
- Do not introduce facts, entities, or subquestions not present in user intent.

### Answer assembly

- Use at most 3 evidence chunks by default.
- De-duplicate adjacent or near-duplicate chunks before composing.
- Prefer evidence diversity across sources/sections when available.
- Keep citations chunk-level.

### Table evidence

- Keep ingestion/chunk projection unchanged for Phase 4.
- Improve answer-time formatting only if current `table_row` / `table` snippet forms are not sufficiently readable.

## Verification Strategy

Phase 4 should verify three layers:

1. **Specialist branch mapping**
   - `completed`
   - `needs_clarification`
   - `no_answer`
   - `error`

2. **Grounded answer behavior**
   - citations remain chunk-traceable
   - multiple evidence sources can be synthesized
   - unsupported answers do not pass as `completed`

3. **Hybrid retrieval consumption**
   - specialist tests should consume the existing hybrid retrieval contract, not bypass it with dense-only assumptions

Suggested commands once plans land:

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_golden_cases`

## Non-Goals For Phase 4

- rerank as default baseline
- `HyDE`
- multi-query decomposition
- hidden multi-turn memory reconstruction
- supervisor-side retrieval logic
- reopening ACL/audit ownership that belongs to Phase 5

---

*Phase 4 research completed: 2026-03-27*
*Applied by implementation and verified on 2026-03-27 against specialist + retrieval + eval test surfaces*
