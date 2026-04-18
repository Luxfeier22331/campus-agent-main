# Phase 7: Verification And Release Gate - Context

**Gathered:** 2026-03-24
**Status:** Historical context; phase complete
**Source:** Derived from roadmap, eval governance docs, local planning docs, and best-practice review confirmed via official documentation on 2026-03-24

## Post-Phase Closeout Note

- Phase 7 的主目标已在 2026-03-27 完成：repo tests、live qrels benchmark、workflow/status 样本与 handbook collection schema 证据均已落盘。
- 2026-03-31 `210128` fresh handbook acceptance rerun 进一步确认：
  - live serving 在 expanded `8`-case release gate 上稳定通过 deterministic gate
  - supplemental runtime 全量可用，`repair` 正确跳过且无 applied targets
  - `procedure_directness` 与 `student-card / materials / time` 三个 procedure signal 已进入正式 artifact truth
  - 当前 artifact truth 的 supplemental soft gate 已全量收口为 `pass`
- 因此当前 handbook follow-up 已不再是 rerun 验证，而是把 `210128` 作为后续 handbook 变更的回归基线；Phase 7 之外剩余的外部 follow-up 只剩真实部署后的 Worker observability verification。

<domain>
## Phase Boundary

Phase 7 closes `VER-01` and `VER-02`. The scope is to establish repeatable repository-level proof that the phase-1 path behaves correctly before release, covering automated tests plus smoke/eval verification for `student_handbook`.

This phase does not redefine golden-truth governance, does not replace prior phase implementation work, and does not let any external eval framework become the repository's canonical protocol.

The phase delivers three things:

- automated verification covers the `supervisor -> rag-specialist -> retrieval` flow and all terminal response semantics
- smoke/eval coverage exercises the `student_handbook` ingestion and query path
- verification outputs are stable enough to act as a release gate

</domain>

<decisions>
## Implementation Decisions

### Locked by roadmap and ADRs
- Phase 7 addresses `VER-01` and `VER-02` only.
- Golden dataset remains a repository-owned protocol under `packages/evals`; it does not adopt `ragas`, OpenAI graders, or other tool-native schemas as canonical truth.
- Metrics remain layered across retrieval, answer, workflow, and safety/gate families.
- Thresholds, scorer prompts, and provider/model choices remain implementation-time decisions, not ADR-level constants.

### Eval bootstrap strategy confirmed in discussion
- Phase-1 bootstrap should follow:
  - small curated smoke set
  - synthetic-heavy but curated-final dataset growth
  - deterministic-only grading by default
  - reference-based offline evaluation as the main initial mode
- Reference-free or LLM-judge grading remains a later enhancement, not a bootstrap prerequisite.
- `ragas` should be treated as an optional adapter or generator helper, not as the repository's eval identity.
- Bootstrap split strategy should follow:
  - actively maintain `smoke`
  - actively maintain `regression_locked`
  - keep `exploratory` isolated for candidate or experimental cases
  - derive the initial `release_gate` from a stable subset of `smoke + regression_locked` instead of immediately maintaining a large standalone gate split
- Split should stay a high-level governance grouping, while finer distinctions such as `incident_backfill`, `table-heavy`, `synthetic_expansion`, or actor-specific coverage should live in case metadata rather than explode the split count.

### Initial grading posture confirmed in discussion
- Bootstrap should begin with deterministic checks wherever repository truth is already explicit and machine-checkable.
- Initial focus is on stable release-signal metrics rather than broad experimental scoring.
- The first gate should prefer low-noise assertions over high-variance judge-model scores.
- Bootstrap mandatory deterministic checks are now confirmed as:
  - `status_accuracy`
  - `expected_doc_hit`
  - `forbidden_doc_miss`
  - `required_facts`
  - `forbidden_claims`
  - `citation_completeness`
- Runner requirement:
  - bootstrap deterministic mode must be able to grade all six checks above
  - individual cases may still disable irrelevant dimensions through explicit grader policy
- Split posture:
  - `smoke` should at minimum exercise `status_accuracy`, `expected_doc_hit`, and `citation_completeness`, with answer checks added whenever the truth is stable
  - `regression_locked` should normally exercise the full mandatory deterministic set
  - derived `release_gate` should be selected from cases that already pass this deterministic surface stably
- `acl_fail_closed` and `error_path_correctness` remain strong optional early additions when the signal is already explicit in the cases and runner output.
- Judge-based `faithfulness`, `retrieval relevance`, and broader rubric scoring remain later-stage additions, not bootstrap mandatory gates.

### Retrieval truth strictness confirmed in discussion
- Bootstrap matching should not require `chunk_id` for every case.
- Recommended strictness ladder:
  - baseline default: `doc_id`
  - when representation stability matters and version truth is stable: `doc_id + version_id`
  - only for high-risk or explicitly locked cases: `doc_id + version_id + chunk_id`
- The same ladder applies to `forbidden_sources`.
- Split-specific default posture should follow:
  - `smoke` defaults to `doc_id`
  - `regression_locked` defaults to `doc_id + version_id`
  - only selected high-risk locked cases escalate to `doc_id + version_id + chunk_id`
- Rationale:
  - retrieval and chunking are still evolving enough that default chunk-level locking would add noisy churn
  - repo truth already needs stable release-signal checks more than overly brittle locator exactness
  - doc-level matching is the best bootstrap default for synthetic-heavy growth and curated-final promotion
  - chunk-level truth should be reserved for cases where exact evidence placement is itself the risk being guarded

### Split maintenance strategy confirmed in discussion
- Bootstrap should actively maintain:
  - `smoke`
  - `regression_locked`
- Bootstrap should allow but not require:
  - `exploratory`
- Bootstrap should not be maintained as a large standalone split yet for:
  - `release_gate`
- Initial `release_gate` should be derived from a stable subset of `smoke + regression_locked` until the corpus, retrieval behavior, and case inventory are mature enough to justify a separately curated gate set.
- Split roles should remain:
  - `smoke` for tiny, high-signal mainline validation
  - `regression_locked` for expensive, risky, or previously failing cases that should not drift silently
  - `exploratory` for candidate and experimental cases, especially synthetic-heavy expansion
  - `release_gate` for the final high-confidence gate, but initially composed from already-proven stable cases instead of opening a fourth active maintenance surface
- Promotion rule should stay explicit:
  - new synthetic-heavy or candidate cases enter `exploratory` first
  - only after truth closure and risk justification do they move into `smoke` or `regression_locked`
  - `release_gate` initially selects from those maintained stable sets rather than acting as a separate intake lane

### Initial case inventory shape confirmed in discussion
- The first bootstrap inventory should stay small and high-signal rather than mirroring a large topical coverage set.
- `smoke` should start with 4 cases, each representing one release-signal branch:
  - one grounded `completed` case
  - one `needs_clarification` case
  - one `no_answer` or fail-closed case
  - one citation/source-locator-sensitive `completed` case
- `regression_locked` should start with roughly 6 to 8 cases:
  - the current stable `student_handbook` topical happy paths
  - plus at least one clarification case
  - plus at least one no-answer case
- The current all-`completed` topical smoke seed is better treated as a topic pool or `regression_locked` candidate set than as the final smoke gate shape.
- Initial `release_gate` should be derived from 4 to 5 already-stable cases selected from `smoke + regression_locked`, not introduced as a separate early-maintenance inventory.
- If table-heavy evidence becomes a stable risk area later, add it first to `regression_locked`, then promote into derived `release_gate` only after evidence formatting and truth closure stabilize.

### External library position confirmed in discussion
- `ragas` is useful for:
  - synthetic query/testset generation
  - selected RAG metrics such as faithfulness or context precision/recall
- In the current phase-1 scope, `ragas` is the better fit for retrieval-facing and groundedness-facing experimentation than OpenAI graders.
- `ragas` is not canonical for:
  - actor truth
  - ACL truth
  - workflow truth
  - release-gate protocol
- Other external evaluators such as OpenAI graders, LangSmith, or DeepEval may also be used behind adapters, but no single tool should define the repo protocol.
- Bootstrap should first implement the repository-owned deterministic runner inside `packages/evals`; an external adapter is not required to make the first eval gate real.
- If an external adapter is researched early, the choice should follow purpose:
  - OpenAI graders are the first research candidate for answer correctness, rubric scoring, and later trace/judge-style grading
  - Ragas is the first research candidate for synthetic generation and selected retrieval/groundedness metrics
- OpenAI graders should not be promoted to the bootstrap gate mainline for the current `rag-specialist`-first phase.
- OpenAI graders become more valuable once evaluation focus expands from retrieval-grounded answering into supervisor-level routing, handoff, trace, and broader workflow behavior.
- Even before that point, `packages/evals` should preserve a clean adapter seam so later OpenAI grader integration does not require changing repository truth or split semantics.
- Repository rule remains explicit:
  - adapters consume repository truth
  - adapters must not define repository truth, split semantics, or gate structure

### Minimal adapter seam confirmed in discussion
- The repository-owned protocol should remain centered on:
  - `GoldenCase` as canonical truth input
  - `ExecutionResult` as observed system output
  - deterministic `CaseResult` as the first-pass grading result
- The first adapter seam should live after canonical execution capture, not inside case storage and not inside truth modeling.
- Concretely, later `ragas` or OpenAI grader integrations should consume a repo-owned projection built from:
  - `GoldenCase`
  - `ExecutionResult`
  - optional deterministic grading output when useful for gating or triage
- Adapters should return supplemental scoring or annotations, not redefine the primary `CaseResult` contract.
- Runner ownership stays inside `packages/evals`:
  - run canonical executor
  - run deterministic grading first
  - optionally invoke adapter-backed judge scoring
  - merge supplemental results into reports without letting tool-native schemas become the repository protocol
- Bootstrap keeps this seam disabled by default; exposing the seam now is for future integration safety, not for immediate gate complexity.

### Supplemental adapter report shape confirmed in discussion
- Supplemental adapter output should be represented beside, not inside, the primary deterministic result.
- `CaseResult` should remain the canonical first-pass gate result for bootstrap.
- Later judge-based or adapter-based output should be attached as optional per-case supplemental results, not folded into the four deterministic dimensions.
- A minimal supplemental item should carry fields in this spirit:
  - adapter identity
  - metric name or rubric name
  - scalar score and/or categorical verdict
  - short rationale
  - gating flag
  - optional metadata payload
- Report semantics should stay explicit:
  - deterministic pass/fail remains the primary release-signal column
  - supplemental scores are initially report-only
  - if one later becomes gating, that promotion should be an explicit phase decision rather than an automatic side effect of adapter presence
- Report structure should therefore follow:
  - `CaseResult` keeps deterministic verdict plus per-case `supplemental_results`
  - `RunReport` keeps deterministic summary plus supplemental metric aggregations
- This separation keeps failure analysis readable:
  - deterministic failures explain contract/truth mismatches
  - supplemental judge output explains higher-level quality, faithfulness, or rubric concerns without obscuring the hard gate reason

### Pending discussion
- The exact first-wave case list: concrete user goals, expected statuses, and truth fields for each bootstrap case

### The agent's Discretion
- Exact file layout and dataclass/API shape inside `packages/evals`, as long as ADR-governed semantics remain intact.
- Whether synthetic candidate generation happens through one adapter or several, as long as canonicalization remains repo-owned.
- The exact bootstrap command split between smoke, regression, and release-gate runners.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and milestone guardrails
- `AGENTS.md` — repo-level planning and verification constraints
- `README.md` — current repo status
- `.planning/PROJECT.md` — project-level scope and active requirements
- `.planning/REQUIREMENTS.md` — `VER-01` and `VER-02`
- `.planning/ROADMAP.md` — Phase 7 goal and success criteria
- `.planning/STATE.md` — current milestone position

### Eval governance and metrics
- `docs/decisions/adr-0003-golden-dataset-governance.md` — canonical truth protocol and split/provenance governance
- `docs/decisions/adr-0004-evaluation-metrics.md` — layered metric families and gate semantics
- `docs/plans/golden-dataset-execution-plan.md` — initial executable schema direction and bootstrap grading posture

### Existing eval and test surfaces
- `packages/evals/README.md` — current eval package boundary
- `tests/evals/test_golden_cases.py` — current golden-case tests
- `tests/specialist/test_rag_specialist.py` — specialist response semantics
- `tests/supervisor/test_supervisor_core.py` — supervisor flow and response shaping
- `tests/retrieval/test_backend_qdrant.py` — retrieval evidence payload expectations

</canonical_refs>

<code_context>
## Existing Code Insights

### Established Patterns
- The repo already distinguishes deterministic protocol assertions from later LLM-based scoring ambitions.
- Eval governance is already split correctly:
  - ADR-0003 answers what golden truth must contain
  - ADR-0004 answers what metric families matter
  - plan docs answer how bootstrap should start
- Current repo truth favors low-noise, schema-first validation before large-scale scorer experimentation.

### Best-Practice Review Findings
- Official guidance supports starting with small manually curated examples before scaling datasets.
- Synthetic-heavy expansion is common, but canonical release truth still needs curation or rule-based closure.
- Deterministic/programmatic grading is the right bootstrap baseline when behavior and truth are explicit.
- External frameworks are best treated as adapters, not as the repository's canonical protocol.

### Integration Points
- `packages/evals` should own adapters and runners, not the architecture or truth protocol itself.
- Retrieval and answer-path phases should feed stable truth into evals; eval bootstrap should not block those phases by prematurely requiring broad LLM-judge infrastructure.

</code_context>

<specifics>
## Specific Ideas

- Start bootstrap with a very small but high-signal `smoke` slice covering:
  - one grounded happy path
  - one clarification path
  - one no-answer or fail-closed path
  - one citation/source-locator correctness path
- Grow coverage through synthetic-heavy candidate generation, but require repo-side canonicalization before promoting anything to `regression_locked`.
- Keep the first release gate explainable: if a case fails, the reason should be visible through deterministic expectations rather than hidden behind a single model score.

</specifics>

<deferred>
## Deferred Ideas

- LLM-judge-heavy bootstrap as a hard requirement
- Tool-native dataset formats becoming canonical truth
- Large exploratory corpora before `student_handbook` release-gate closure
- Prematurely locking one framework such as `ragas` as the default long-term evaluation stack

</deferred>

---

*Phase: 07-verification-and-release-gate*
*Context gathered: 2026-03-24 via ADR review + bootstrap plan review + official best-practice search*
