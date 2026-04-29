---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 6 Summary: Acceptance Freeze And Closeout

<!-- markdownlint-disable MD013 -->

## Completed

- Froze the selected cohort artifact:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-02-selected-cohort-audit/evidence/selected-cohort-audit-20260428.json`
- Froze the current selected cohort verdict:
  - `requested_notice_ids=16`
  - `selected_import_notice_ids=[]`
  - `held_notice_ids=["187233"]`
  - `missing_projection_notice_ids=15`
- Froze `187233` as the negative fixture:
  `parent_notice_body_not_full_regulation_text`, `notice_card_only`, no target import.
- Froze Phase 0 PG/bucket cleanup evidence as the accepted target-reference audit for this
  closeout. Phase 6 did not rerun real PG/bucket smoke.
- Froze the rejected document-site dry-run artifact:
  `.tmp/historical-intake/run14-policy-regulation-expanded/document-site-dry-run-187233-rejected-20260428/dry-run-report.json`
- Updated the runbook so missing-owner cases must pass owner-recovery before target
  materialization, and unresolved cases remain notice-level title/url/card/query.
- Marked the workstream completed and moved it out of the active registry.

## Frozen Invariants

- `campus_notices/internal_notice` remains source/card/query material.
- `regulations/institutional_rules` and `regulations/scoped_rules` only accept complete
  canonical regulation/scoped-rule text.
- Amendment summaries, wrapper notices, missing-owner notices, and reference-only notices fail
  closed unless owner-recovery finds a source-backed complete owner document.
- LLMs may assist classification/extraction, but must not invent missing regulation body text.
- Formal import remains selected-only and requires prior dry-run evidence.
- This workstream did not open query-serving, RAG release, or public/docs product entrypoints.

## Verification

Final targeted verification:

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_owner_recovery.py \
  apps/ingestion-worker/src/campus_ingestion_worker/build_internal_notice_regulation_owner_recovery.py \
  tests/ingestion/test_internal_notice_regulation_owner_recovery.py \
  tests/ingestion/test_build_internal_notice_regulation_owner_recovery_worker.py
```

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_owner_recovery.py \
  apps/ingestion-worker/src/campus_ingestion_worker/build_internal_notice_regulation_owner_recovery.py \
  tests/ingestion/test_internal_notice_regulation_owner_recovery.py \
  tests/ingestion/test_build_internal_notice_regulation_owner_recovery_worker.py
```

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_owner_recovery \
  tests.ingestion.test_build_internal_notice_regulation_owner_recovery_worker \
  tests.ingestion.test_internal_notice_regulation_selected_cohort_audit \
  tests.ingestion.test_internal_notice_read_model \
  tests.ingestion.test_document_reader_publisher \
  tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep \
  tests.ingestion.test_internal_notice_scoped_rule_chunk_prep -v
```

```bash
pnpm --filter app-api exec vitest run -c vitest.node.config.mts \
  test/docs.read-model-manifest.test.ts
```

```bash
pnpm docs:lint
git diff --check
```

Results:

- `ruff check`: `All checks passed!`
- `ruff format --check`: `4 files already formatted`
- targeted ingestion unittest set: `30 tests OK`
- app-api docs manifest test: `1 file / 2 tests passed`
- `pnpm docs:lint`: `Summary: 0 error(s)`
- `git diff --check`: passed

## Reopen Rule

Reopen this workstream only if:

- a new regulation-like notice family is admitted to target consumption;
- ADR-0035 or the `regulations/*` target boundary changes;
- document-site/RAG preparation is promoted from offline preparation to real user entrypoint;
- PG/bucket/reference audit finds a partial source notice in `regulations/*`;
- owner-recovery accepts a new source-backed complete owner document and needs formal import
  evidence.
