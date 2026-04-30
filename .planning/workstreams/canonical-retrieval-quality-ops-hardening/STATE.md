---
doc_type: state
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Canonical Retrieval Quality Ops Hardening

## Current Status

- status: `active`
- current slice: Phase 0 completed; Phase 1 is next
- owner: current Codex session
- active implementation: Phase 1 qrels denominator policy / fixture validator expansion next
- latest completed phase: Phase 0 `Scope And Denominator Freeze`
- next phase: Phase 1 `Qrels And Acceptance Expansion`
- status note: `gsd-sdk workstream.status` reports any phase directory with `PLAN.md` and no
  `SUMMARY.md` as `in_progress`; ROADMAP `Status:` lines remain the human execution truth for
  planned-but-not-started phases in this workstream.

## Captured Context

2026-05-01 planning context:

- `canonical-retrieval-release-hardening` is completed and should not be reused for the remaining
  quality / ops gaps.
- Current release-managed retrieval path already has release acceptance, chunk quality, qrels
  coverage, release provenance, runtime drift guard, embedding cache identity, payload index audit,
  JSONL observation sink and deterministic rerank eval branch.
- Remaining gaps are quality and operations maturity:
  - qrels / acceptance fixtures are still bootstrap-sized.
  - real-scale release cost / latency / capacity evidence is not yet captured.
  - runtime observation is still JSONL-first instead of a durable production intake.
  - reranker is eval-only, not governed by a production opt-in gate.
  - `freshness_sensitive` / `live_assisted` remain target/deferred branches.
  - focused workstream gates and repo-wide dirty-worktree gates need clearer separation.

2026-05-01 Phase 0 context:

- Phase 0 evidence is captured at
  `evidence/phase-00-scope-and-denominator-freeze/inventory.md`.
- Current default query-enabled scopes are `regulations/student_rules`,
  `regulations/institutional_rules`, `curriculum/curriculum_plan` and
  `official_web/stable_reference`.
- `validate_default_query_enabled_qrels_coverage()` currently reports `issues 0`.
- The current gap is not missing basic fixtures; it is that normalized denominator classes and
  collection policies should become machine-checkable planning / eval truth rather than duplicated
  hard-coded release constants.

2026-05-01 current opened-content verification:

- Operator scope for this verification explicitly excluded `official_web/*`; this does not mutate
  the repo-level default query-enabled policy, it only records the current execution boundary.
- Verified opened non-official scopes: `regulations/student_rules`,
  `regulations/institutional_rules`, and `curriculum/curriculum_plan`.
- Excluded from this verification: `official_web/stable_reference`, `regulations/scoped_rules`
  because it is not default query-enabled, `campus_services/*`, and
  `campus_notices/internal_notice`.
- Evidence:
  - `uv run --all-packages python -m unittest tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite tests.evals.retrieval_benchmark_qrels_curriculum_suite tests.evals.retrieval_benchmark_qrels_alias_validation_suite -q` -> `41 tests OK`
  - `uv run --all-packages python -m unittest tests.agent.rag_agent_request_prompt_suite tests.agent.rag_agent_request_prompt_contract_suite tests.agent.rag_agent_request_prompt_grounding_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_curriculum_resolution_suite tests.agent.rag_agent_curriculum_resolution_initial_suite tests.agent.rag_agent_curriculum_resolution_followup_suite tests.agent.rag_agent_curriculum_resolution_bias_suite tests.agent.rag_agent_curriculum_structured_lookup_suite tests.agent.rag_agent_curriculum_structured_lookup_access_suite tests.agent.rag_agent_curriculum_structured_lookup_query_suite tests.agent.rag_agent_curriculum_structured_lookup_named_document_suite tests.agent.rag_agent_curriculum_semester_answering_suite tests.agent.rag_agent_curriculum_semester_selection_suite tests.agent.rag_agent_curriculum_planning_suite tests.supervisor.agent_dispatch_suite tests.supervisor.agent_dispatch_response_suite tests.supervisor.agent_handoff_suite tests.contracts.contract_models_request_and_retrieval_suite -q` -> `180 tests OK`
  - `uv run --all-packages python -m unittest tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite tests.evals.retrieval_benchmark_qrels_curriculum_suite tests.evals.retrieval_benchmark_qrels_alias_validation_suite tests.evals.retrieval_tuning_suite tests.evals.retrieval_release_benchmark_suite tests.retrieval.retrieval_service_backend_and_request_projection_suite tests.retrieval.retrieval_service_replan_execution_suite tests.retrieval.backend_qdrant_policy_suite tests.retrieval.backend_qdrant_curriculum_ranking_suite tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite tests.retrieval.backend_qdrant_curriculum_ranking_prioritization_suite tests.retrieval.test_curriculum_query_resolution -q` -> `138 tests OK`
  - scoped local policy check for the three non-official opened scopes -> `opened_non_official_profiles=3`, `opened_non_official_qrels=3`, `coverage_issues=0`
- An accidental run of `tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite`
  failed in `official_web/stable_reference` / `official_web/fresh_news`
  freshness/live-assisted cases. Those failures are outside this verification scope and are not
  counted as blockers for current opened non-official content consumption.

## Blockers

- No external blocker for Phase 0 planning and denominator freeze.
- Later phases may require real Qdrant / object store / embedding provider credentials for
  benchmark and smoke evidence.
- Repo-wide validation is currently expected to remain noisy because unrelated workstreams have
  dirty files; this workstream must use focused gates until integration cleanup.

## Verification Plan

Baseline planning/docs gate:

```bash
pnpm exec markdownlint-cli2 \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/REQUIREMENTS.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/ROADMAP.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/STATE.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/phases/**/*.md
```

Phase implementation gates will be recorded in the phase summaries as they are executed.

## Continuity Notes

- Do not reopen or edit `canonical-retrieval-release-hardening` unless its explicit reopen rule is hit.
- Keep this workstream scoped to retrieval quality / ops; do not absorb authenticated-notice,
  campus-services tools, public web UI, or unrelated CI cleanup.
- Treat runtime observations as eval/backlog intake only; they do not mutate release truth.
- Keep raw query text disabled by default in any production observation path.
