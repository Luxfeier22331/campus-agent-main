---
doc_type: phase_summary
phase: "13"
phase_name: "Historical Regulation Canonical Backfill"
status: implemented
created: 2026-05-02
updated: 2026-05-02
---

# Phase 13 Summary

## Result

Phase 13 added the code path required to rebuild historical collected-notice
regulation targets through the current ingestion canonical cleaner before RAG
release.

Implemented entrypoints:

- core builder:
  `campus_ingestion_core.collected_notice_regulation_canonical_backfill`
- worker CLI:
  `campus-ingestion-backfill-collected-notice-regulation-canonical`

## Behavior

- first-batch rows are rebuilt from candidate audit plus admission manifest and
  source owner text;
- manual-review rows are rebuilt from candidate audit, owner-text execution
  report and explicit target resolution;
- old Phase 6R/Phase 9/Phase 11 materialization JSON is not used as canonical
  text input;
- execute mode reuses selected materialization guards, including
  `normalization_quality=passed`;
- generated evidence keeps `query_serving_opened=false` and
  `rag_release_opened=false`.

## Evidence Target

Default output directory:

`.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/`

Expected files include:

- `canonical-backfill-report.json`
- `first-batch/materialization.execute.json`
- `first-batch/regulation-normalization-quality-report.json`
- `manual-review/materialization.execute.json`
- `manual-review/regulation-normalization-quality-report.json`
- `manual-review/manual-review-resolution-report.json`
- `manual-review/serving-closed-assertion.json`

## Verification

Focused tests:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_regulation_canonical_backfill \
  tests.ingestion.test_backfill_collected_notice_regulation_canonical_worker
```

## Remaining Runtime Step

Run the worker in the target operator environment:

```bash
uv run --all-packages campus-ingestion-backfill-collected-notice-regulation-canonical --execute
```

This writes refreshed canonical artifacts and registry rows. It still does not
open query serving or RAG release; those remain controlled by the independent
regulation RAG release lane.
