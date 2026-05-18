---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 2: Taxonomy And Registry Normalization

## Goal

把 `condition_subject`、procedure action、category overview 等语义从中文 cue 判断迁移到 registry /
taxonomy 驱动的受控体系。

## Scope

- Build reusable regulation-family taxonomy records.
- Normalize condition subject vocabulary.
- Normalize procedure action vocabulary.
- Normalize category registry coverage.
- Add provenance for taxonomy assignment.
- Implement the Phase 0 taxonomy admission/change policy.
- Record taxonomy version impact on release profile/cache invalidation.

## Deliverables

- Shared taxonomy/registry contract under `packages/shared` for canonical values, role membership,
  category ids, procedure actions, condition subjects, provenance field names and version constants.
- Ingestion-only source alias patterns and extractor implementation under `packages/ingestion-core`,
  emitting shared taxonomy ids and versions instead of private canonical values.
- Condition subject taxonomy covering at least:
  - audience / applicant identity
  - rank threshold
  - paper / publication / research output
  - academic performance
  - conduct / discipline status
  - material requirement
  - deadline / time window
  - appeal / review right
  - student card / identity credential
  - dormitory / accommodation
  - degree / graduation requirement
- Procedure action taxonomy covering at least:
  - `apply`
  - `submit_materials`
  - `college_review`
  - `office_review`
  - `publish_notice`
  - `appeal`
  - `report_loss`
  - `reissue`
- Generalized category registry covering at least:
  - scholarship
  - student_status
  - discipline
  - dormitory
  - student_card
  - degree
  - appeal
- Tests proving no one-off scholarship-only path.
- Tests proving new values cannot be added without admission metadata and alias review coverage.
- Institutional category/action/subject fixtures from `INSTITUTIONAL-DENOMINATOR.md`.

## Implementation Boundaries

- Taxonomy values must be controlled and versioned.
- Unknown values are explicit degradation, not silent fallback.
- Runtime query handling may consume taxonomy output but must not own taxonomy assignment.
- Retrieval and eval may import shared taxonomy values, but must not import ingestion-only extractor
  rules.
- Taxonomy version changes must be visible to release admission so stale releases can be invalidated
  or revalidated.

## Verification

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline -q
uv run --all-packages ruff check packages/shared packages/ingestion-core tests/shared tests/ingestion
uv run --all-packages ruff format packages/shared packages/ingestion-core tests/shared tests/ingestion --check
```

## Exit Criteria

- Taxonomy registry can assign subjects/actions/categories from structured context and registry
  metadata.
- Scholarship path is not special-cased.
- Category overview can be generated for all admitted registry categories with member document ids
  and titles.
- Taxonomy version/provenance appears in metadata.
- Unknown/degraded values are auditable and fail query-serving release when required metadata is
  missing.
- Institutional-rule taxonomy coverage is proven before final rebuild.

## Non-Goals

- Full document rebuild.
- Reranker adoption.
