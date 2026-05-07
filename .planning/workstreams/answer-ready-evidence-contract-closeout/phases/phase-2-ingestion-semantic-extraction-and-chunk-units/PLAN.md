---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Ingestion Semantic Extraction And Chunk Units

## Goal

Emit answer-ready metadata from ingestion/chunking as the primary truth, including typed condition,
procedure, category overview and parent-child context fields.

## Tasks

1. Extend answer-role metadata production.
   - `regulation_answer_roles.py`
   - Add or normalize only answer roles approved by Phase 0 `TAXONOMY-GOVERNANCE.md`.
   - Attach condition subject and role confidence where deterministic.
2. Add condition subject extraction.
   - Use the Phase 0 controlled vocabulary in `TAXONOMY-GOVERNANCE.md`.
   - Keep extraction deterministic and test-backed.
   - New subject values require ingestion, retrieval ranking/selection and component eval tests
     before they are admitted.
3. Add typed procedure step extraction.
   - Step index when list order exists.
   - Actor/action/materials/next actor when deterministic.
   - Do not over-extract from responsibility or recordkeeping text.
4. Strengthen category overview metadata.
   - `process_candidate_postprocess.py`
   - Ensure category id, audience, member policy ids/titles and overview document id are present.
5. Add parent-child context.
   - Stable parent unit id for article/clause-level chunks.
   - Derive `parent_unit_id` from the Phase 0 `PARENT-UNIT-ID.md` rule, not chunk order,
     retrieval score, release id or Qdrant collection.
   - Preserve article label, clause label and section path.
   - Preserve `member_parent_unit_ids` as retrieval-internal metadata for aggregated chunks where
     needed for duplicate-parent suppression.
6. Add and update tests.
   - `tests/ingestion/test_handbook_chunking_pipeline.py`
   - `tests/evals/retrieval_chunk_quality_suite.py`
   - Add samples for discipline relief, national scholarship rank/paper, scholarship overview and
     student-card reissue.
7. Run a small real-document dry run before Phase 6 backfill.
   - National scholarship rank threshold and paper condition.
   - Discipline relief procedure and exclusion.
   - Scholarship category overview.
   - Student-card reissue procedure.
   - Table fact evidence.
8. Preserve institutional adoption boundary.
   - Keep extraction model reusable for `institutional_rules` where natural.
   - Do not expand full `institutional_rules` backfill into this phase unless Phase 0 made it a
     blocker.

## Acceptance

- Required metadata is present before indexing.
- Answer roles and condition subjects conform to Phase 0 taxonomy governance.
- Procedure chunks have typed procedure fields where deterministic.
- Judgment-relevant condition chunks have condition subject.
- Category overview chunks have member policy ids/titles.
- Parent context follows the stable Phase 0 parent-unit derivation rule.
- A small real-document dry run proves the extraction contract before Phase 6 rebuild/backfill.
- No new hard-coded one-off policy special case; rules must generalize by answer role/subject.
- `institutional_rules` compatibility notes are recorded if shared extraction behavior changes.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_handbook_chunking_pipeline \
  tests.evals.retrieval_chunk_quality_suite -q
uv run --all-packages ruff check packages/ingestion-core packages/evals tests/ingestion tests/evals
```
