---
doc_type: phase_plan
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 1: Contract V3 And Schema Governance

## Goal

冻结 `answer_ready_evidence.v3` 内部 contract，让 ingestion、retrieval、quality gate 和 eval 使用同一套
schema，不再各自猜字段含义。

## Scope

- Extend the shared answer-ready regulation contract.
- Define required fields by evidence role.
- Define validation severity:
  - release blocking
  - degraded but non-serving
  - legacy old-index compatibility
- Define schema version and migration behavior.
- Define provenance fields for semantic assignment.
- Define schema fields needed by the Phase 0 semantic oracle.
- Define validation inputs that can support both `student_rules` and `institutional_rules`.

## Deliverables

- Shared schema implementation under `packages/shared`.
- Version constants for `answer_ready_evidence.v3`.
- Role-specific required-field matrix for:
  - `condition_rule`
  - `exclusion_rule`
  - `exception_rule`
  - `material_requirement`
  - `procedure_step`
  - `eligibility_intro`
  - `category_overview`
  - `table_fact`
- Contract validation API for ingestion/release gate/retrieval tests.
- Unit tests for schema validation.
- Schema fixtures for both `student_rules` and `institutional_rules`.
- Phase summary updating `GAP-LEDGER.md`.

## Implementation Boundaries

- Do not move backend/vendor payload shapes into `packages/contracts`.
- Shared schema must remain provider-agnostic and storage-agnostic.
- Public `EvidenceSource` stays unchanged; Phase 0 did not identify a public DTO need.

## Verification

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_registry_scope_release_acceptance_wiring -q
uv run --all-packages ruff check packages/shared tests/shared
uv run --all-packages ruff format packages/shared tests/shared --check
```

## Exit Criteria

- v3 schema can validate positive and negative fixtures.
- Missing required fields produce deterministic machine-readable failures.
- Legacy v2/old-index data can be classified without satisfying target completion.
- Field names and roles are documented in code and phase summary.
- Institutional-rule fixtures validate against the same v3 schema, not a student-rule fork.

## Non-Goals

- Rewrite chunking.
- Release any collection.
- Add model/LLM extraction.
