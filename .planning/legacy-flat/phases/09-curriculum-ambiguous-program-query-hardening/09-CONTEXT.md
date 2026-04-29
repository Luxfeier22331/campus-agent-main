# Phase 9: Curriculum Ambiguous Program Query Hardening - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning
**Source:** Derived from current merged-truth docs, current `curriculum_plan` retrieval/rag implementation, recent repo-local curriculum hardening work, and external best-practice research on ambiguity-aware RAG and clarification

<domain>
## Phase Boundary

Phase 9 hardens `curriculum/curriculum_plan` for ambiguous program-family and short-fragment questions that currently mix:

- generic family aliases such as `基地班` / `实验班` / `创新班`
- overly broad oral aliases such as `民族班`
- deictic questions such as `我这个专业的基地班`
- semester/course-list queries that still lack a uniquely resolved培养方案
- personalization hints that are useful for biasing retrieval but not strong enough to silently collapse ambiguity

The goal is to make the existing `supervisor -> rag-specialist -> retrieval-core` path behave correctly for these cases without changing product topology, without adding a new specialist, and without pushing curriculum-specific resolution logic into `supervisor-core` or `packages/contracts`.

The phase should deliver six outcomes:

- `rag-specialist` owns a curriculum-specific resolve / bias / clarify planning lane, parallel to the existing handbook policy-object lane.
- curriculum alias handling is governed by repo-tracked config with explicit tiers, rather than a single global string-replacement table.
- `verified identity`, `profile memory`, and session-confirmed slots can bias curriculum resolution, but only as typed soft hints.
- unresolved family-alias questions return `needs_clarification` before the system silently locks onto a single培养方案.
- retrieval can distinguish hard document targeting from soft preferred-candidate bias without weakening existing ACL/current/revision filters.
- eval truth treats unresolved family aliases as clarification cases or preflight errors, not canonical single-doc qrels.

The phase does not:

- reopen supervisor routing or app topology
- move curriculum alias logic into `packages/contracts`
- let personalization widen authorization or serving scope
- let profile memory alone hard-resolve a curriculum document
- reintroduce bad canonical truth that locks short ambiguous aliases to one doc

</domain>

<decisions>
## Implementation Decisions

### Locked by current architecture truth

- `rag-specialist` remains the owner of retrieval planning, ambiguity-aware clarification, and answer/no-answer branching.
- `retrieval-core` remains the owner of metadata pre-filter, hybrid retrieval, ranking, and evidence shaping.
- `app-api` remains the owner of runtime request projection and operator-facing diagnostics.
- `packages/contracts` may carry generalized document-resolution diagnostics if needed, but must not encode MUC-specific alias tables or curriculum resolver heuristics.

### Phase 9 problem statement is explicit

- The current repo already hardens one class of curriculum queries: uniquely named program + semester/course-list questions.
- The remaining failure mode is not “curriculum retrieval is missing”.
- The remaining failure mode is that short family aliases and weak personalization can still tempt the system to over-fit a single培养方案 when the query text is not specific enough.
- The system must prefer fail-closed clarification over silent over-personalization.

### Required handling posture

- Generic family aliases such as `基地班`, `实验班`, `创新班`, and `民族班` are not safe global hard aliases.
- Alias governance must distinguish at least four classes:
  - safe aliases that can be normalized directly
  - family aliases that only expand or bias candidate generation
  - scoped aliases that require a major/program/doc family constraint
  - forbidden generic aliases that must not enter canonical single-doc truth
- `verified identity` may contribute to hard resolution only when the query is explicitly deictic and the active candidate set becomes uniquely determined.
- `profile memory` and `recent_goal` may influence ranking or clarification wording, but may not by themselves hard-resolve a target document.
- If the query remains ambiguous after applying safe normalization and typed hints, the correct terminal behavior is `needs_clarification`.

### Retrieval-core changes Phase 9 should prefer

- Keep `target_document_ids` as the hard narrowing mechanism for conservatively resolved curriculum documents.
- Add a distinct soft-bias mechanism such as `preferred_document_ids` rather than overloading hard filters.
- Keep hard filters and soft bias separated:
  - hard target = retrieval-time metadata pre-filter
  - soft preference = ranking-time bonus only
- Existing ACL / scope / revision-track / current-serving semantics must remain unchanged.

### Diagnostics posture

- Request/result diagnostics should become document-resolution oriented rather than handbook-policy-specific.
- Summary diagnostics should distinguish:
  - `resolution_mode`
  - whether `verified_identity` participated
  - whether only soft bias was used
  - clarification reason
  - candidate title summary
- Diagnostics remain summary-only and must not project raw retrieval internals into operator views.

### The agent's discretion

- Exact config file naming and storage location inside `packages/rag-specialist`
- Exact thresholding and ranking bonus values for soft preference
- Exact split between planner-local logic and retrieval ranking helpers
- Exact enum names for diagnostics, provided they remain semantically clear and testable

</decisions>

<canonical_refs>
## Canonical References

### Repo and milestone truth

- `AGENTS.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/reference/eval-gold-truth-model.md`
- `docs/reference/curriculum-plan-eval-metrics.md`

### Existing code surfaces

- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist/src/campus_rag_specialist/intent.py`
- `packages/rag-specialist/src/campus_rag_specialist/query_planning.py`
- `packages/retrieval-core/src/campus_retrieval_core/curriculum_query_resolution.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/contracts/src/campus_contracts/models.py`

### Existing eval and test surfaces

- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/fixtures/curriculum_plan_retrieval_qrels.json`
- `packages/evals/fixtures/curriculum_plan_hybrid_queries.json`
- `tests/specialist/test_rag_specialist.py`
- `tests/retrieval/test_curriculum_query_resolution.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_retrieval_benchmark.py`

</canonical_refs>

<workstreams>
## Proposed Workstreams

### Workstream 1: Curriculum query-planning split

- Split handbook-only planning out of `packages/rag-specialist/src/campus_rag_specialist/query_planning.py`.
- Add a curriculum-specific planner module plus repo-tracked MUC alias governance config.
- Introduce a typed `CurriculumQueryPlan` that can express:
  - hard resolved document targeting
  - soft preferred candidates
  - clarification reason
  - clarification candidates
  - resolution mode / trust source

### Workstream 2: Soft personalization without silent collapse

- Reuse existing typed personalization inputs from `ActorContext`, profile memory, and session summary.
- Freeze the resolution ladder:
  - explicit query wording
  - verified identity
  - session-confirmed slot
  - profile memory
- Allow only the top two tiers to contribute to hard resolution.
- Keep lower-confidence personalization as rerank/clarification input only.

### Workstream 3: Retrieval hard-filter vs soft-bias split

- Preserve `target_document_ids` for hard-narrowed resolved queries.
- Add a separate soft preference field to retrieval request/ranking helpers.
- Keep `curriculum_query_resolution.py` focused on deterministic normalization and same-doc/semester evidence scoping.
- Move higher-level alias governance and ambiguity posture into `rag-specialist`.

### Workstream 4: Truth governance and eval fast-fail

- Promote family-alias ambiguity from `warn`/implicit behavior to explicit canonical governance.
- Add deterministic clarification cases for `基地班`-style queries.
- Forbid canonical qrels from using profile memory alone to justify single-doc truth.
- Add deictic + verified-identity cases that prove when auto-resolution is acceptable.

</workstreams>

<verification>
## Verification Targets

- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.retrieval.test_curriculum_query_resolution tests.retrieval.test_backend_qdrant`
- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark tests.evals.test_curriculum_live_benchmark`
- `uv run --all-packages python -m unittest discover -s tests -t .`

Success means:

- `基地班` does not silently collapse to a single doc from profile memory alone
- `我这个专业的基地班` can resolve only under verified-identity + unique-candidate conditions
- resolved program/semester queries remain same-doc / same-semester constrained
- canonical qrels and workflow cases fail closed on unresolved family aliases

</verification>

<external_validation>
## External Validation Snapshot

External best-practice references reviewed for this phase:

- OpenAI reasoning best practices: ask clarifying questions when ambiguity materially changes the correct answer.
- OpenAI knowledge retrieval blueprint: grounded retrieval + eval-driven governance.
- EMNLP 2025 query disambiguation survey: query rewriting, answer generation, and clarification should be orchestrated; rewriting alone has high wrong-answer risk.
- ACL 2024 CLAMBER: LLMs are unreliable at deciding when to clarify without explicit structure.
- SIGDIAL/EACL 2024 clarification work: option-list clarification is stronger than vague follow-up questions.
- EMNLP 2023 personalized retrieval: personalization should bias ranking, not collapse coverage through over-restrictive routing.

</external_validation>

<deferred>
## Deferred Ideas

- curriculum-wide ontology extraction across every special program family
- default multi-query or HyDE for curriculum
- panel-side raw retrieval debugging
- opening historical-version curriculum serving

</deferred>

---

*Phase: 09-curriculum-ambiguous-program-query-hardening*
*Context gathered: 2026-04-02 via merged-truth doc/code audit plus external best-practice review*
