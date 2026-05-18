---
doc_type: review
status: active
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Review: Retrieval Intent Taxonomy Contract Closeout

## Verdict

The workstream is valid after review, but the initial plan had boundary problems that would have
made later implementation drift from the accepted RAG/retrieval architecture.

## Fixed Findings

### P1: `RetrievalIntent` Was Planned Too Broadly

Initial planning listed `packages/contracts` in the owner boundary and used contract-suite
verification for Phase 1. That conflicts with the accepted internal RAG retrieval-plan seam:
`RetrievalPlan` / `RetrievalStep` stay internal to `rag-agent <-> retrieval-core`, and browser /
supervisor shared contracts must not depend on this internal query-serving state.

Fix:

- `RetrievalIntent` is now explicitly placed inside the RAG/retrieval internal seam.
- Phase 1 now forbids adding `RetrievalIntent` to `packages/contracts`.
- Verification now uses new `tests.agent.rag_agent_retrieval_intent_contract_suite` rather than
  shared contract suites.

### P1: retrieval-core Was Accidentally Made An Intent Owner

Initial planning said retrieval-core should consume intent. That would invert the current boundary:
rag-agent owns query/answer semantics and builds typed retrieval plans; retrieval-core executes
plans, applies generic failure and reranker execution policy, and shapes evidence.

Fix:

- README, requirements and Phase 4/5 now state that retrieval-core does not import or own
  `RetrievalIntent`.
- rag-agent derives `RetrievalPlan` fields from `RetrievalIntent`.
- retrieval-core only receives typed plan fields, generic failure kinds and runtime-profile reranker
  policy.

### P2: Reranker Ownership Was Ambiguous

Initial planning described "intent/profile" adoption in a way that could let `RetrievalIntent`
override runtime profile ownership.

Fix:

- Phase 6 is now `Runtime-Profile Reranker With Intent Eligibility`.
- Runtime profile remains the adoption owner.
- Intent eligibility can only narrow profile opt-in, not enable reranker by itself.

### P2: Typed Answer Scope Was Too Broad

Initial planning described typed answer object as internal primary for supported RAG answer kinds,
which could overreach into curriculum and official-web answers before their typed contracts exist.

Fix:

- Phase 7 now limits typed answer primary status to supported regulation answer kinds.
- Public natural-language response shape remains unchanged.

### P2: Diagnostics Boundary Needed Hardening

Initial planning only blocked raw provider output and SDK-native types.

Fix:

- Phase 8 now also blocks raw retrieval backend payloads from diagnostics output.

## Remaining Planned Risks

- Phase 0 artifacts now exist: `INTENT-MAPPING.md` and `CONTRACT-FREEZE.md`.
- Phase 3 must be careful not to delete curriculum/title/fact answer shape behavior while removing
  independent regulation answer-kind ownership.
- Phase 4 must treat the current `RetrievalIntent` projections as the rag-agent source for plan
  fields, but retrieval-core still cannot import the model.
- Phase 6 must not make `rerank_policy` override runtime profile ownership.
- Phase 7 must keep typed answer primary limited to supported regulation answer kinds unless a
  separate contract is added for curriculum/official-web.
- Existing eval workstream changes in the worktree are outside this workstream and must not be
  treated as evidence for this plan.
- Full `pnpm docs:lint` currently fails on unrelated `infra/otel/README.md` line length; this
  workstream's own markdown lint passes.
