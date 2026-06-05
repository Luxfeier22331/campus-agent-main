---
doc_type: phase_summary
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Retrieval Ranking, Selection And Replan Consumption

Phase 3 made retrieval ranking consume the typed answer-ready evidence projection as the primary
signal for target student-rules cases and made old-index legacy signals observable.

## Artifacts

- `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking_features.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_execution.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_observations.py`
- `tests/retrieval/evidence_contract_ranking_suite.py`
- `tests/retrieval/retrieval_service_replan_execution_suite.py`

## Code Changes

- Extended the retrieval-internal evidence accessor to preserve typed semantic fields from the
  answer-ready sidecar: `semantic_role`, `polarity`, `action_type`, `claim_type`,
  `audience_scope`, `article_no`, `clause_no` and `section_kind`.
- Added `EvidenceFallbackDiagnostics` and source-level legacy-signal detection for missing
  `answer_role`, `parent_unit_id` or `evidence_contract_version`.
- Extended query intent with `condition_subject` and `category_id`.
- Updated semantic alignment so:
  - positive procedure queries prefer `answer_role=procedure_step`
  - negative restriction queries preserve `exclusion_rule` / `exception_rule`
  - category discovery prefers `category_overview` / `policy_list`
  - judgment queries prefer matching `condition_subject`
- Added legacy diagnostic labels to `RetrievalStepActivity` and sanitized retrieval observations:
  `fallback_used`, `fallback_reason`, `missing_contract_fields`,
  `source_index_contract_version` and `fallback_primary_signal`.
- Kept public `EvidenceSource` unchanged and kept backend/provider-specific payload shapes out of
  `packages/contracts`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.backend_qdrant_policy_focus_ranking_suite \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.agent.rag_agent_realistic_e2e_samples_suite \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.retrieval.evidence_contract_ranking_suite \
  tests.retrieval.evidence_attributes_suite -q
```

Result: `Ran 68 tests ... OK`.

```bash
uv run --all-packages ruff check packages/retrieval-core packages/rag-agent tests/retrieval tests/agent
```

Result: `All checks passed!`.

## Follow-Up For Phase 4

- Add typed answer drafts inside `rag-agent` for policy list, procedure steps, eligibility judgment
  and condition table answers.
- Ensure typed draft validation projects support into the existing claim/evidence diagnostics
  surface and does not create a second grounding truth.
