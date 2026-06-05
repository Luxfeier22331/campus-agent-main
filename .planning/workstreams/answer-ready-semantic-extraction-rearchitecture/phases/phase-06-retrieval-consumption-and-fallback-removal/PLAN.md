---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 6: Retrieval Consumption And Legacy Signal Removal

## Goal

让 retrieval ranking、selection 和 replan 以 v3 typed metadata 为主路径，并把目标 rebuilt regulation
release 的 primary text-cue fallback 清零。

## Scope

- Update retrieval evidence attributes to consume v3 schema.
- Update ranking feature extraction.
- Update supporting evidence selection.
- Update post-retrieval self-check and replan triggers.
- Add legacy-signal diagnostics and hard target release budget.
- Consume the Phase 0 semantic oracle for query-conditioned contradiction cases.

## Deliverables

- Retrieval-core v3 metadata accessor.
- Ranking features for:
  - procedure intent vs procedure evidence
  - restriction/exclusion intent vs negative evidence
  - category discovery vs category overview
  - eligibility judgment vs condition subject / polarity
  - table fact vs table evidence
- Replan triggers for:
  - missing required answer role
  - polarity mismatch
  - subject mismatch
  - category coverage missing
  - repeated same parent over-selection
  - intro/procedure/ratio weak evidence over-selection
- Legacy-signal diagnostic labels:
  - `fallback_used`
  - `fallback_reason`
  - `fallback_primary_signal`
  - `missing_contract_fields`
  - `source_index_contract_version`
- Tests proving zero primary legacy-signal reliance for v3 fixtures.
- Tests proving query-conditioned contradictions such as positive-procedure query vs negative
  exclusion evidence are attributed to ranking/selection, not release gate.

## Implementation Boundaries

- First-stage retrieval remains recall-oriented.
- Replan must not widen authz, version, scope or runtime profile.
- Legacy-signal reads may remain only for old-index quarantine and must be observable.

## Verification

```bash
uv run --all-packages python -m unittest tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.retrieval.retrieval_service_replan_execution_suite -q
uv run --all-packages ruff check packages/retrieval-core tests/retrieval
uv run --all-packages ruff format packages/retrieval-core tests/retrieval --check
```

## Exit Criteria

- Typed metadata is the primary ranking/selection signal.
- Rebuilt v3 fixtures report zero primary text-cue reliance.
- Old-index legacy signals are still supported only as diagnostics.
- Known polarity cases such as `处分怎么消` select positive procedure evidence over negative
  restrictions.
- Stage-local diagnostics report `ranking_mismatch` or `selection_not_answer_ready` when the oracle
  expectation is violated.

## Non-Goals

- Adopt an LLM reranker.
- Open live retrieval.
