---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 3: Clause Parent-Child Unit Model

## Goal

让 regulation chunking 拥有稳定的 clause-level / parent-child answer-ready unit model，避免一个
chunk 混入标题、引导句、主条件、例外、示例、流程句后只能靠检索后裁剪。

## Scope

- Define canonical parent unit id derivation.
- Define clause child unit ids.
- Define condition group ids.
- Split answer-ready child units while preserving parent context.
- Preserve table row/window answer readiness.
- Cover both handbook-style and institutional-rule document structures selected in Phase 0.

## Deliverables

- Parent/child unit model document for v3 regulation chunks.
- Chunking implementation changes in `packages/ingestion-core`.
- Metadata propagation for:
  - `parent_unit_id`
  - `clause_unit_id`
  - `condition_group_id`
  - `article_no`
  - `clause_no`
  - `section_path`
- Tests for:
  - parent context preservation
  - condition group stability
  - no mixed intro/condition/exclusion/procedure chunk when answer readiness would be harmed
  - table chunk answer readiness
  - institutional parent-child unit identity and condition grouping

## Implementation Boundaries

- Do not rewrite source truth or canonical markdown in chunking.
- Do not let chunking clean正文 that belongs in canonical materialization.
- Do not create serving aliases.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance tests.evals.retrieval_chunk_quality_suite -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion tests/evals
uv run --all-packages ruff format packages/ingestion-core tests/ingestion tests/evals --check
```

## Exit Criteria

- Answer-ready units have stable parent-child ids.
- Related conditions can be grouped without merging them into one overbroad chunk.
- Retrieval evidence can cite child evidence while retaining parent article context.
- Existing chunk budget policy remains respected.
- Institutional rule chunks preserve parent context without relying on handbook-only assumptions.

## Non-Goals

- Recompute embeddings.
- Change tokenizer or chunk size.
