---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Retrieval Ranking, Selection And Replan Consumption

## Goal

Make retrieval-core and rag-agent consume typed evidence metadata as primary ranking/selection
signals, with text cues retained only as legacy quarantine diagnostics.

## Tasks

1. Extend query intent model.
   - `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py`
   - Represent desired answer role, polarity, action type and condition subject.
2. Extend ranking features.
   - `evidence_ranking_features.py`
   - Prefer `answer_role`, `condition_subject`, `polarity`, `action_type`, parent context and
     answer-readiness.
   - Consume fields through the Phase 1 approved accessor instead of directly coupling to a public or
     internal storage shape.
3. Update supporting evidence selection.
   - `evidence_ranking.py`
   - `agent_selection_rows.py`
   - Reject intro/supporting detail when answer-ready alternatives exist.
   - Preserve negative evidence for negative queries.
   - Preserve category overview for discovery queries.
4. Add replan diagnostics.
   - Missing answer role.
   - Condition subject mismatch.
   - Polarity mismatch.
   - Category coverage missing.
   - Duplicate parent-unit over-selection.
5. Enforce legacy cue deprecation policy.
   - Old-index quarantine samples may expose text cues only with observable legacy diagnostics.
   - Legacy diagnostic labels must include `fallback_used`, `fallback_reason`, `missing_contract_fields`,
     `source_index_contract_version` and `fallback_primary_signal`.
   - Rebuilt target cases must fail tests if typed metadata is absent and text cues become primary.
   - Target rebuilt `student_rules` cases have `0` primary text-cue budget.
6. Add tests.
   - Positive procedure vs negative exclusion.
   - Negative restriction query.
   - Rank-threshold judgment.
   - Paper/publication condition.
   - Category discovery overview.
   - Legacy cue diagnostics only when typed metadata is absent.

## Acceptance

- Typed metadata outranks title/score when query intent is strong.
- Legacy text-cue diagnostics are observable, test-covered and report the Phase 0 required fields.
- Rebuilt `student_rules` target cases do not pass primarily through text cues.
- Replan does not widen scope, authz, version or serving surface.
- Existing current retrieval behavior for non-regulation/curriculum cases is not regressed.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.backend_qdrant_policy_focus_ranking_suite \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.agent.rag_agent_realistic_e2e_samples_suite \
  tests.agent.rag_agent_answer_quality_regression_suite -q
uv run --all-packages ruff check packages/retrieval-core packages/rag-agent tests/retrieval tests/agent
```
