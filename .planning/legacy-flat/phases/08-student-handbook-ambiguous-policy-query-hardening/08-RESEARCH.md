# Phase 8: Student Handbook Ambiguous Policy Query Hardening - Research

**Researched:** 2026-04-02
**Confidence:** HIGH
**Execution Status:** Planning ready

## Executive Summary

Phase 8 does not need a new architecture decision.

The existing long-term boundary is already correct:

- `supervisor` keeps routing/policy ownership
- `rag-specialist` owns retrieval planning and fail-closed answer behavior
- `retrieval-core` owns retrieval request shape and backend filtering
- `app-api` owns operator-facing request diagnostics

The real missing capability is narrower:

1. resolve policy objects from informal aliases and incomplete references
2. route resolved-object queries into targeted handbook retrieval
3. return `needs_clarification` when the policy object is still ambiguous
4. return object-scoped `no_answer` when the selected policy does not contain the asked rule
5. expose enough structured diagnostics for operators and evals

## Findings

### What is already true

- `student_handbook` is already a query-enabled runtime surface with `dense + sparse + RRF + registry-backed evidence shaping`.
- Formal policy titles such as `中央民族大学本科学生国家奖学金评审办法` already retrieve correctly.
- `delegate_to_rag_agent()` already owns `completed`, `needs_clarification`, `no_answer`, and `error`.
- `QdrantRetrievalBackend` already has document-scoped retrieval primitives through source-scoped support expansion.
- `apps/app-api` already persists runtime request/projection records and can carry summary diagnostics to the operator panel.

### What is missing

- No collection-level alias/object map exists for handbook policy names.
- `RetrievalRequest` has no first-class targeted document field.
- Current clarification logic is generic and not policy-object-aware.
- Current `no_answer` wording is generic and does not say “the resolved policy does not state this”.
- The handbook eval surface lacks explicit regression cases for:
  - informal policy aliases
  - missing policy object
  - cross-policy lexical contamination
  - object-resolved but unsupported clause

### Failure mode confirmed by live diagnosis

- A real query about `国奖` plus `第一作者 / 第二作者 / 分` retrieved handbook evidence, but top-ranked evidence came from `中央民族大学本科学生综合素质测评办法`.
- The system was not failing because the correct policy was absent.
- It was failing because unresolved alias semantics lost to stronger lexical matches from a different policy table.
- When the formal title `国家奖学金评审办法` is used explicitly, retrieval already centers the correct policy.

## Chosen Direction

### 08-01: Add policy-object resolution inside `rag-specialist`

- Add a specialist-local query planning module for handbook policy-object resolution.
- Keep the logic conservative:
  - normalize aliases
  - resolve to one or more formal handbook documents
  - detect unresolved or conflicting policy targets
  - return `needs_clarification` when confidence is insufficient
- Do not move this logic into `supervisor-core`.

### 08-02: Add typed document-targeted retrieval in `retrieval-core`

- Extend `RetrievalRequest` with optional targeted handbook document IDs.
- Extend retrieval filters so resolved-object queries can restrict dense and sparse prefetch to the selected formal document(s).
- Keep existing ACL, scope, revision-track, and current-only filters intact.
- Preserve generic collection retrieval for non-referential questions.

### 08-03: Tighten response semantics and request diagnostics

- If a policy object is unresolved, return `needs_clarification` with policy-object wording.
- If a policy object is resolved but the document does not state the asked rule, return object-scoped `no_answer`.
- Add runtime projection summaries for:
  - resolved policy object
  - rewritten query
  - clarification reason
  - no-answer reason
  - retrieved title summary

### 08-04: Add explicit regression coverage

- Extend handbook golden cases and live benchmark coverage with policy-object ambiguity cases.
- Extend retrieval benchmark coverage with document-targeting and cross-policy contamination cases.
- Keep the new cases grounded in current `student_handbook` document IDs and titles.

## Validation Architecture

Phase 8 should validate along four layers:

1. specialist planning/clarification unit tests
2. retrieval-core filter/ranking unit tests
3. handbook benchmark and live executor trace assertions
4. operator projection persistence/read-surface tests

The fastest regression loop should stay on focused Python and TypeScript test subsets first, then run the handbook live benchmark acceptance path after implementation stabilizes.

## Verification Strategy

- Python unit/integration:
  - `tests/specialist/test_rag_specialist.py`
  - `tests/retrieval/test_backend_qdrant.py`
  - `tests/evals/test_golden_cases.py`
  - `tests/evals/test_handbook_live_benchmark.py`
  - `tests/evals/test_retrieval_benchmark.py`
- TypeScript runtime/operator projection:
  - `apps/app-api` projection/runtime command tests covering persisted clarification/no-answer diagnostics
  - `apps/protected-panel-web` request-presenter tests if display format changes
- Final repo verification:
  - `uv run --all-packages python -m unittest discover -s tests -t .`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark run --reruns 3`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl`

## Non-Goals

- adding a scholarship specialist
- reopening supervisor/app topology
- adding new external corpora
- adopting rerank, HyDE, or broad multi-query retrieval as part of this phase
- exposing raw retrieval internals directly in operator UI
- mixing Worker observability verification into handbook query hardening

---

*Phase 8 research completed: 2026-04-02*
