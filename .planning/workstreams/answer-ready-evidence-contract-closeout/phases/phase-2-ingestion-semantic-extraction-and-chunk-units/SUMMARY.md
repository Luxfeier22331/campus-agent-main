---
doc_type: phase_summary
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Summary: Ingestion Semantic Extraction And Chunk Units

Phase 2 added ingestion-side answer-ready evidence contract metadata for `student_rules` chunks and
kept the extraction generic by answer role, condition subject, parent unit and procedure fields.

## Artifacts

- `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/process_chunking.py`
- `packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`

## Code Changes

- Added `answer_ready_evidence.v1` as the ingestion-side contract version.
- Added `parent_unit_id` for answer-ready chunks from stable root/category units.
- Added condition subject inference for rank threshold, paper/publication, material requirement,
  deadline, audience scope, application procedure and generic condition cases.
- Added condition polarity normalization where `exception_rule` remains positive override evidence
  and `exclusion_rule` remains negative evidence.
- Added typed procedure metadata: `procedure_step_index`, `procedure_actor`, `procedure_action`,
  optional `procedure_materials` and optional `procedure_next_actor`.
- Strengthened category overview chunks with `parent_unit_id`, `evidence_contract_version`,
  `category_audience` and member metadata.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_handbook_chunking_pipeline \
  tests.evals.retrieval_chunk_quality_suite -q
```

Result: `Ran 43 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py \
  packages/ingestion-core/src/campus_ingestion_core/process_chunking.py \
  packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py \
  tests/ingestion/test_handbook_chunking_pipeline.py \
  tests/evals/retrieval_chunk_quality_suite.py
```

Result: `All checks passed!`.

## Broad Gate Note

The broad Phase 2 ruff command over `packages/evals` and all `tests/evals` is currently blocked by
pre-existing unrelated format/lint issues in official-web/service-guide eval files. The focused Phase
2 changed-file gate passes.

## Follow-Up For Phase 3

- Ranking and selection must consume the Phase 1 typed accessor and Phase 2 metadata before text
  cues.
- Fallback diagnostics must report Phase 0 required fields.
