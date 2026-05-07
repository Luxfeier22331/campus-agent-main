---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Contract Inventory And Boundary Freeze

## Goal

Produce the evidence-field inventory and freeze public/internal contract boundaries before
implementation.

## Tasks

1. Inventory ingestion metadata production.
   - Read `regulation_answer_roles.py`, `handbook_semantics.py`, `regulation_chunking.py`,
     `process_candidate_postprocess.py`, `process_candidate_aggregation.py`.
   - Record every produced answer-ready field and which unit/chunk type emits it.
1. Inventory retrieval projection.
   - Read `backend_qdrant_source_metadata.py`, `backend_qdrant_evidence.py`,
     `models_retrieval.py`.
   - Record which fields survive payload -> `EvidenceSource`.
1. Inventory runtime consumers.
   - Read `evidence_semantics.py`, `evidence_ranking_features.py`, `evidence_ranking.py`,
     `query_focus.py`, `agent_selection_rows.py`, `agent_answer_shape.py`.
   - Record whether each consumer uses typed fields or fallback text cues.
1. Inventory eval/release gates.
   - Read `retrieval_chunk_quality.py`, `retrieval_chunk_quality_suite.py`,
     `test_handbook_chunking_pipeline.py` and relevant agent regression suites.
   - Record missing gate coverage.
1. Freeze component eval contract in `EVAL-CONTRACT.md`.
   - Define regression sample matrix.
   - Define stage failure taxonomy.
   - Define expected intent / evidence role / draft kind fields.
1. Freeze taxonomy governance in `TAXONOMY-GOVERNANCE.md`.
   - Define controlled vocabularies.
   - Define unknown/generic/other handling.
   - Define taxonomy versioning and no one-off subject rule.
1. Freeze parent unit id rule in `PARENT-UNIT-ID.md`.
   - Define derivation source and stability contract.
   - Define article/clause/list/table/category overview encoding.
   - Define qrels/citation compatibility posture.
1. Create `FIELD-MATRIX.md` in this phase directory.
   - Columns: field, producer, payload key, `EvidenceSource` field, consumer, eval gate,
     current status, proposed owner.
1. Freeze contract split in `CONTRACT-DECISION.md`.
   - Decide public `EvidenceSource` fields.
   - Decide retrieval-internal typed attributes.
   - Decide ingestion-only diagnostics.
   - For every success-criteria field, name the mandatory online projection path consumed by
     ranking/selection/typed drafts.
1. Create `FALLBACK-DEPRECATION.md`.
   - Define when text-cue fallback is allowed.
   - Define fallback diagnostics and eval reporting.
   - Define the rebuilt `student_rules` target cases where fallback must fail.
1. Create `RELEASE-GATE-DECISION.md`.
   - Identify the existing regulation release-admission module or CLI path to extend.
   - Identify required fixture/manifest evidence.
   - Identify the fail-close test owner and expected failing sample.

## Acceptance

- `FIELD-MATRIX.md` maps all fields listed in requirements.
- `EVAL-CONTRACT.md` defines stage-local eval schema and target samples before Phase 1.
- `TAXONOMY-GOVERNANCE.md` defines controlled vocabulary/versioning.
- `PARENT-UNIT-ID.md` defines stable parent id derivation and migration posture.
- `CONTRACT-DECISION.md` identifies exact Phase 1 implementation scope.
- `CONTRACT-DECISION.md` does not leave required online fields without a public or internal
  projection owner.
- `FALLBACK-DEPRECATION.md` defines fallback budget, diagnostics and rebuilt-index disallow list.
- `RELEASE-GATE-DECISION.md` names the concrete release-admission hook and fail-close test path.
- No proposed field leaks backend/vendor implementation details into `packages/contracts`.
- No implementation files are changed in Phase 0 unless correcting planning docs.

## Verification

```bash
pnpm docs:lint
uv run --all-packages ruff check packages/ingestion-core packages/retrieval-core packages/rag-agent packages/evals tests
```

If repo-wide lint is blocked by unrelated dirty worktree issues, record focused markdown/file checks
and the blocker explicitly in `SUMMARY.md`.
