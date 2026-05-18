---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 5: Answer-Ready Quality Gates

## Goal

把 chunk quality gate 和 release admission 从“缺陷检查”升级为静态 answer-ready metadata correctness
admission；query-conditioned contradiction checks 留给 retrieval/component eval。

## Scope

- Integrate v3 contract validation into chunk quality gate.
- Integrate v3 contract validation into regulation RAG release admission.
- Add static semantic consistency checks that do not depend on a particular user query.
- Wire query-conditioned contradiction expectations into Phase 6/8 tests instead of release
  admission.
- Add quality summary fields for release manifests.
- Add downgrade classifications for non-serving or legacy-only data.

## Deliverables

- Quality gate implementation updates.
- Release admission manifest fields:
  - `answer_ready_contract_version`
  - `answer_ready_contract_status`
  - `answer_ready_required_field_failures`
  - `answer_ready_semantic_failures`
  - `fallback_budget_status`
- Tests proving fail-closed behavior for missing or wrong v3 metadata.
- Tests proving release gates do not need a user query to evaluate chunk validity.
- Tests proving query-conditioned contradictions are asserted by retrieval/component eval fixtures.
- Tests proving `regulations/scoped_rules` remains non-serving.
- Phase summary with gate command evidence.

## Implementation Boundaries

- Do not add standalone checks that release lane does not consume.
- Do not allow query-enabled regulation publish with `answer_ready_contract_status != passed`.
- Do not change serving surface allowlist.
- Do not put user-query-specific ranking expectations into release admission.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion tests/evals
uv run --all-packages ruff format packages/ingestion-core tests/ingestion tests/evals --check
```

## Exit Criteria

- Query-enabled regulation release admission fails closed on v3 contract errors.
- Static semantic consistency cases fail even if fields are present but internally contradictory.
- Query-conditioned contradiction cases are covered in Phase 6/8, not encoded as release-admission
  rules.
- Release quality output is machine-readable and can be audited after publish.
- Old-index compatibility is classified separately from v3 release readiness.

## Non-Goals

- Run full rebuild.
- Change retrieval ranking.
