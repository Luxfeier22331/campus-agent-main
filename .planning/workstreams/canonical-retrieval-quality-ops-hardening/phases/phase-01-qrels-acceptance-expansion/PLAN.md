---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Qrels And Acceptance Expansion

## Objective

把 qrels / acceptance fixtures 从 bootstrap coverage 扩成 query-enabled collection 的最低质量
denominator，并保持 release publish fail-closed。

## Tasks

1. Extend qrels fixture schema if Phase 0 finds missing scenario metadata.
2. Expand fixtures for current default query-enabled collections:
   - `regulations/student_rules`
   - `regulations/institutional_rules`
   - `curriculum/curriculum_plan`
   - `official_web/stable_reference`
3. Add or update validator rules:
   - minimum case count
   - required scenario ids
   - required coverage classes
   - missing referenced case ids
   - no-hit / hard negative presence
4. Add pending candidate manifest path for runtime observations that should be reviewed before
   becoming canonical qrels.
5. Update release acceptance tests and runbook.

## Verification

- `uv run --all-packages python -m unittest` focused ingestion release acceptance and eval tests.
- Targeted ruff check / format check for touched Python files.
- Targeted markdownlint for changed docs/planning files.

## Exit Criteria

- Missing required scenario fails release coverage validation.
- All default query-enabled collections pass the expanded denominator.
- Runtime observation candidates are separated from canonical qrels truth.
