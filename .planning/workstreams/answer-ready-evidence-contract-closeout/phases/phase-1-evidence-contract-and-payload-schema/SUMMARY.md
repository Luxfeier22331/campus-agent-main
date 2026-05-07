---
doc_type: phase_summary
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Evidence Contract And Payload Schema

Phase 1 implemented the retrieval-internal answer-ready evidence projection/accessor without
broadening the public `EvidenceSource` contract.

## Artifacts

- `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- `tests/retrieval/evidence_attributes_suite.py`

## Code Changes

- Added `EvidenceAttributes` and `ProcedureAttributes` as retrieval-core internal typed views.
- Added `evidence_attributes_for_source(source)` as the single accessor for Phase 1 fields.
- Added Qdrant payload preservation through an internal anchor sidecar,
  `_retrieval_evidence_attributes`, instead of adding public `EvidenceSource` fields.
- Preserved old-index compatibility by deriving fallback values from existing public fields such as
  `semantic_role`, `polarity`, `action_type`, `claim_type`, `source_unit_key` and `anchor.root_unit_id`.
- Updated evidence semantic alignment to consume the typed accessor before falling back to public
  fields.
- Kept backend/provider-specific payload shape out of `packages/contracts`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.evidence_attributes_suite \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.backend_qdrant_filters_suite \
  tests.contracts.contract_boundary_guardrails_suite -q
```

Result: `Ran 33 tests ... OK`.

```bash
uv run --all-packages ruff check packages/contracts packages/retrieval-core tests/contracts tests/retrieval
```

Result: `All checks passed!`.

## Follow-Up For Phase 2

- Ingestion must emit stable metadata for `answer_role`, `condition_subject`, `parent_unit_id`,
  `evidence_contract_version`, procedure fields, category overview fields and condition groups before
  indexing.
- Phase 2 should use the Phase 0 taxonomy and parent-unit decisions rather than adding query-specific
  one-off fields.
