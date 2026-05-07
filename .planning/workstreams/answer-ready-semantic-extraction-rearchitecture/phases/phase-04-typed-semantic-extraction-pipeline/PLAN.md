---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 4: Typed Semantic Extraction Pipeline

## Goal

让 ingestion 从 structured units、taxonomy、registry、section path 和 document category 产出 v3 typed
metadata，而不是依赖运行时中文 cue 推断。

## Scope

- Refactor regulation semantic extraction pipeline.
- Produce typed condition subjects with provenance.
- Produce condition groups.
- Produce typed eligibility intro contract.
- Produce typed procedure step contract.
- Produce generalized category overview contract.
- Emit contract validation results during chunk preparation.
- Use `SEMANTIC-ORACLE.md` as the expected semantic output source.

## Deliverables

- Updated ingestion semantic extraction modules.
- Contract-producing pipeline for:
  - conditions
  - exclusions
  - exceptions
  - material requirements
  - procedure steps
  - eligibility intros
  - category overviews
  - table facts
- Structured metadata fixtures from real documents.
- Oracle-backed extraction fixture table proving expected semantic fields.
- Tests for realistic samples:
  - `处分怎么消`
  - `哪些情况不能解除处分`
  - `成绩没前十还能评国奖吗`
  - `论文能不能算国奖条件`
  - `本科生有哪些奖学金能申请`
  - `学生证丢了怎么补`
  - institutional rule category/procedure sample selected in Phase 0

## Implementation Boundaries

- Do not add query-time special cases.
- Do not treat a missing taxonomy assignment as success.
- Degraded extraction must be explicit and block query-serving release when answer-ready metadata is
  required.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance tests.evals.retrieval_chunk_quality_suite -q
uv run --all-packages ruff check packages/ingestion-core packages/shared tests/ingestion tests/evals
uv run --all-packages ruff format packages/ingestion-core packages/shared tests/ingestion tests/evals --check
```

## Exit Criteria

- Required v3 metadata is produced at ingestion time.
- Metadata carries version/provenance.
- Test fixtures prove semantic correctness, not only field presence.
- `condition_group_id` and typed intro/procedure/category contracts are present in prepared chunks.
- Every target sample in `SEMANTIC-ORACLE.md` either matches expected semantics or produces a named
  degraded/fail-closed reason.

## Non-Goals

- Production release publish.
- Supervisor answer behavior changes.
