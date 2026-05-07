---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Evidence Contract And Payload Schema

## Goal

Implement the minimum stable evidence contract and payload resolver support needed for answer-ready
metadata to survive indexing and retrieval projection.

## Prerequisite

Phase 0 `CONTRACT-DECISION.md` must exist and explicitly approve the public/internal field split.

## Tasks

1. Keep public `EvidenceSource` unchanged by default.
   - Phase 0 decision: implement a retrieval-internal typed evidence projection/accessor first.
   - Do not add `answer_role`, `condition_subject`, `parent_unit_id` or
     `evidence_contract_version` to public `EvidenceSource` unless Phase 1 proves that a minimal
     scalar must cross package boundaries.
   - If public promotion becomes necessary, document the exact consumer and keep the field scalar,
     vendor-neutral and backwards compatible.
2. Add retrieval-core payload resolver support.
   - `backend_qdrant_source_metadata.py`
   - `backend_qdrant_evidence.py`
3. Add package-local typed evidence attributes as the primary Phase 1 contract.
   - Candidate file: `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`.
   - Expose a single accessor used by ranking, selection and typed answer draft construction.
   - The accessor must expose `answer_role`, `condition_subject`, `parent_unit_id`,
     `evidence_contract_version`, procedure attributes, category overview attributes and condition
     group attributes where payload metadata provides them.
4. Add normalization rules.
   - Empty strings remain backwards compatible.
   - Unknown answer role / condition subject values are preserved or normalized only if Phase 0 says
     so.
   - No enum hard failure unless release gate owns migration.
5. Add tests.
   - Retrieval-internal accessor defaults/backwards compatibility.
   - Qdrant payload -> typed evidence accessor projection.
   - Public contract guard proving no broad `EvidenceSource` expansion occurred unless explicitly
     justified in this phase.
   - Missing-field old payload remains readable.
   - New-field payload appears in ranking feature extraction input.
   - Add new focused suite `tests/retrieval/evidence_attributes_suite.py` for the typed accessor.

## Acceptance

- Old evidence payload tests still pass.
- New fields are visible through the Phase 1 typed evidence accessor where payload provides them.
- Ranking/selection inputs consume the typed accessor rather than reaching directly into raw payload
  metadata or public-contract side channels.
- Every success-criteria field has an approved retrieval-internal projection owner unless this phase
  records a specific public scalar promotion decision.
- No supervisor/app-api contract changes are required.
- No SDK/native/provider types appear in `packages/contracts`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.evidence_attributes_suite \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.backend_qdrant_filters_suite \
  tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check packages/contracts packages/retrieval-core tests/contracts tests/retrieval
```
