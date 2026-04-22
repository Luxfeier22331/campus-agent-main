# Phase 8: Student Handbook Ambiguous Policy Query Hardening - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning
**Source:** Derived from current merged-truth docs, current retrieval/rag implementation, live diagnosis of a real ambiguous national-scholarship query, and the accepted long-term supervisor-led boundary

<domain>
## Phase Boundary

Phase 8 hardens `regulations/student_handbook` query quality for ambiguous policy questions that currently mix:

-口语制度别名，例如 `国奖`
-缺失正式制度对象，例如只说“这个问题”
-跨制度强词面，例如 `第一作者 / 第二作者 / 分`
-对象内未写明条款与对象外近似规则的混淆

The goal is to make the existing `supervisor -> rag-specialist -> retrieval-core` path behave correctly for these cases without changing product topology, without adding a new specialist, and without reopening Worker/web/deployment architecture.

The phase delivers five outcomes:

- `rag-specialist` can resolve or reject ambiguous handbook policy objects before generic retrieval.
- retrieval can optionally lock search to one or more resolved handbook documents instead of relying only on free-text query wording.
- object-missing questions return `needs_clarification` proactively instead of being dragged to the wrong document by strong lexical overlap.
- object-resolved but unsupported questions return object-scoped `no_answer` rather than generic handbook fallback wording.
- operator-facing request diagnostics record enough structured information to explain why a query clarified, abstained, or targeted a specific document.

The phase does not:

- change supervisor routing topology
- add a new response status
- introduce a new specialist
- expand query-serving beyond current `student_handbook` / `curriculum_plan`
- move retrieval strategy into `supervisor-core`
- reopen Cloudflare / Worker / app-api runtime topology

</domain>

<decisions>
## Implementation Decisions

### Locked by current architecture truth
- `supervisor` remains the only product entry and keeps top-level control; it does not absorb retrieval planning or answer synthesis.
- `rag-specialist` remains the owner of retrieval planning behaviors such as query rewrite, title / terminology bias, ambiguity-aware clarification, and answer shaping.
- `retrieval-core` remains the owner of retrieval request shape, metadata filtering, dense+sparse+RRF execution, registry-backed evidence shaping, and any document-level retrieval filter abstraction.
- `apps/app-api` remains the owner of runtime request projection and operator-facing read APIs; panel diagnostics must come from runtime-owned projection fields, not direct retrieval inspection.

### Phase 8 problem statement is now explicit
- The current real-world failure mode is not “RAG missed the handbook entirely”.
- The current failure mode is: a query like `民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？` does retrieve handbook evidence, but is lexically pulled toward `综合素质测评办法` because `第一作者 / 第二作者 / 分` matches table-based scoring chunks more strongly than the unresolved alias `国奖` matches the formal policy title.
- When the formal title `国家奖学金评审办法` is used, retrieval already centers the correct document. Therefore the missing capability is policy-object resolution and object-scoped retrieval, not a brand-new corpus or topology.

### Required handling posture
- If a question is obviously policy-referential but does not uniquely identify the target rule/object, default to `needs_clarification`.
- If a policy object can be resolved conservatively from aliases and surrounding cues, retrieval should bias or filter toward that object before generic full-collection search wins on lexical overlap.
- Conservative rewrite must not invent new facts, new institutions, or new subquestions. It may only normalize aliases, expand formal policy names, and isolate the residual sub-question.
- If the resolved policy document does not contain the rule the user asks about, return `no_answer` scoped to that policy document. Do not silently import a nearby rule from a different制度.
- Cross-document evidence may be used as contrast only when the answer explicitly says it is a different制度, not as silent support for the primary answer.

### Retrieval-core changes Phase 8 should prefer
- Add an explicit retrieval request field for targeted document filtering, such as resolved `document_id` candidates, instead of encoding document targeting only by appending formal titles into free text.
- Keep targeted filtering optional and collection-scoped. Generic retrieval remains valid for non-referential questions.
- Preserve current ACL / scope / revision-track filtering. Document targeting is additive, not a bypass.

### Runtime diagnostics posture
- Request projection should expose governance summaries for this class of failures:
  - resolved policy object
  - rewritten query
  - clarification reason
  - no-answer reason
  - retrieved title summary
- Diagnostics must stay summary-level. Do not project raw chunk text, vector scores, or infrastructure-specific metadata into operator views.

### The agent's discretion
- Exact split between alias dictionary, heuristic resolver, and ambiguity classifier inside `packages/rag-specialist`, as long as the final behavior is conservative and testable.
- Exact naming of new retrieval request fields and diagnostic projection fields, as long as boundaries remain intact and the fields are semantically clear.
- Exact benchmark case phrasing, provided the real failure mode is preserved and the evals can deterministically detect regressions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and milestone truth
- `AGENTS.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/REQUIREMENTS.md`

### Architecture and policy boundaries
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`

### Collection/runtime truth
- `configs/ingestion/regulations/student_handbook/runtime-profile.json`
- `configs/ingestion/regulations/student_handbook/split-manifest.v1.json`

### Existing code surfaces
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `packages/rag-specialist/src/campus_rag_specialist/confidence.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/app-api/src/modules/projection/service.ts`
- `apps/protected-panel-web/src/panel/requests/request-show.tsx`

### Existing eval and test surfaces
- `packages/evals/src/campus_evals/handbook_live_benchmark.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_handbook_live_benchmark.py`
- `tests/evals/test_retrieval_benchmark.py`
- `tests/specialist/test_rag_specialist.py`
- `tests/retrieval/test_backend_qdrant.py`

</canonical_refs>

<code_context>
## Existing Code Insights

### Current implementation truth
- `retrieve_sources()` currently forwards the raw query string into `RetrievalRequest.query_text` and does not expose a first-class document-targeting field.
- `QdrantRetrievalBackend` already supports source-scoped follow-up retrieval for document support expansion, which means document-level filtering primitives already exist in the backend and can be generalized rather than invented from scratch.
- `evidence_ranking.py` currently prioritizes title overlap, detail/content lexical support, answer-bearing bonuses, content-role priority, and source score. This is why unresolved policy aliases can lose to strong table-lexical matches from another制度.
- `delegate_to_rag_agent()` already owns clarification, no-answer, and final answer branching, so Phase 8 should extend this control surface rather than creating a parallel preprocessor path elsewhere.
- `apps/app-api` already persists `needs_clarification` and `no_answer` outcomes into runtime request/projection surfaces, which makes it the correct place to add summary-level diagnostics.

### Reusable assets
- The current handbook manifest already gives stable `document_id -> title` mapping for formal policies.
- The existing handbook live benchmark captures retrieved sources and supporting sources, which is enough to assert whether a query was dragged toward the wrong document.
- The current retrieval benchmark fixtures already support title/fixed-phrase style regression cases and can be extended rather than replaced.

### Implementation gap to close
- The repo lacks a collection-level alias/object map for handbook policy titles.
- The repo lacks a typed way for `rag-specialist` to ask `retrieval-core` for “search only within these resolved documents”.
- The repo lacks a dedicated regression suite for ambiguous policy-object questions that mix formal and informal terminology.
- The operator request projection does not yet surface why a query clarified or abstained in policy-object terms.

</code_context>

<specifics>
## Specific Ideas

- Add a `student_handbook` query-planning config file that maps informal policy aliases to formal handbook documents and records ambiguity-prone competing terms.
- Add Phase 8 golden cases based on the real national-scholarship / comprehensive-evaluation confusion:
  - alias-only but resolvable
  - alias + cross-policy lexical contamination
  - unresolved object requiring clarification
  - object-resolved but unsupported clause requiring `no_answer`
  - explicit formal title successfully targeting the intended document
- Prefer a two-step specialist strategy:
  1. resolve/clarify policy object
  2. run targeted retrieval or generic retrieval depending on confidence
- For diagnostics, project only summary strings/enums that help operators understand routing and abstain behavior.

</specifics>

<deferred>
## Deferred Ideas

- new specialist types for scholarship policy
- broader ontology extraction across all handbook collections
- LLM-heavy open-ended multi-query decomposition by default
- rerank or HyDE adoption as part of this phase
- panel-side direct retrieval debugging views
- deployment/observability work that belongs to the separate Worker post-deploy verification follow-up

</deferred>

---

*Phase: 08-student-handbook-ambiguous-policy-query-hardening*
*Context gathered: 2026-04-02 via live failure diagnosis + merged-truth architecture/docs/code audit*
