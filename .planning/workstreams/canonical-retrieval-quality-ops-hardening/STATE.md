---
doc_type: state
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Canonical Retrieval Quality Ops Hardening

## Current Status

- status: `completed`
- current slice: Phase 0-6 completed on 2026-05-01
- owner: current Codex session
- active implementation: none; workstream closed
- latest completed phase: Phase 6 `Gate Separation And Closeout`
- next phase: none
- status note: all planned phases have `SUMMARY.md`; reopening requires the reopen rule below.

## Captured Context

2026-05-01 planning context:

- `canonical-retrieval-release-hardening` is completed and should not be reused for the remaining
  quality / ops gaps.
- Current release-managed retrieval path already has release acceptance, chunk quality, qrels
  coverage, release provenance, runtime drift guard, embedding cache identity, payload index audit,
  JSONL observation sink and deterministic rerank eval branch.
- At creation, remaining gaps were quality and operations maturity:
  - qrels / acceptance fixtures are still bootstrap-sized.
  - real-scale release cost / latency / capacity evidence is not yet captured.
  - runtime observation is still JSONL-first instead of a durable production intake.
  - reranker is eval-only, not governed by a production opt-in gate.
  - `freshness_sensitive` / `live_assisted` remain target/deferred branches.
  - focused workstream gates and repo-wide dirty-worktree gates need clearer separation.

2026-05-01 closeout context:

- Qrels denominator policy, release acceptance expansion, dry-run release benchmark, durable
  observation event seam, reranker adoption gate, freshness/live explicit branch contract and
  focused gate separation are implemented.
- Real provider/Qdrant benchmark and production observation storage rollout remain explicit
  non-blocking operational follow-ups, not implementation ambiguity in this workstream.
- Production observation接入方向已记录为 runtime adapter owned OTel-compatible bridge：
  retrieval-core 保持 vendor-neutral injected sink，runtime shell 负责把
  `retrieval.runtime_observation` 转成 logs/events/derived metrics 并交给 Collector/backend。

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
- `tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite` was re-run after
  freshness/live contract closeout and now reports `6 tests OK`; previous accidental failure notes
  are stale and should not be treated as current blockers.

## Blockers

- No implementation blocker remains for focused workstream completion.
- Real Qdrant / object store / embedding provider credentials are still required for non-dry-run
  benchmark and production smoke evidence.
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

Focused closeout gate:

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_qrels_policy_suite \
  tests.evals.retrieval_tuning_suite \
  tests.evals.retrieval_release_benchmark_suite \
  tests.evals.retrieval_monitoring_suite \
  tests.evals.retrieval_rerank_eval_suite \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite \
  tests.retrieval.backend_qdrant_release_guard_suite
```

Observed result: `Ran 104 tests ... OK`.

Focused Python lint/format:

```bash
uv run --all-packages ruff check <workstream Python files>
uv run --all-packages ruff format --check <workstream Python files>
```

Observed result: `All checks passed!` and `24 files already formatted`.

## Continuity Notes

- Do not reopen or edit `canonical-retrieval-release-hardening` unless its explicit reopen rule is hit.
- Keep this workstream scoped to retrieval quality / ops; do not absorb authenticated-notice,
  campus-services tools, public web UI, or unrelated CI cleanup.
- Treat runtime observations as eval/backlog intake only; they do not mutate release truth.
- Keep raw query text disabled by default in any production observation path.
- Keep production observability integration outside retrieval-core. Add OTel/exporter/backend code
  only in runtime adapter / deployment integration, with JSONL retained as local/debug sink.

## Reopen Rule

Reopen this workstream only if a new default query-enabled scope lacks denominator policy or release
acceptance coverage; release benchmark schema / dry-run posture drifts; runtime observation stops
emitting sanitized durable events; reranker can run without deterministic adoption evidence,
runtime-profile opt-in or degraded reranker diagnostic observation; freshness/live branches leak into default
`current` retrieval; or focused/repo-wide gate separation becomes ambiguous again.
