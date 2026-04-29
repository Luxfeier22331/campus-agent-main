---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
phase: Phase 9
workstream: notice-consumption-layer
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Summary: Consumer Admission Manifest And Release Gate

## Completed

- Added repo-owned internal notice consumer admission manifest model, validation,
  deterministic JSON writer, and stable selected-notice hash.
- Added deterministic manifest builders for bundle records and selected source-truth
  inventory entries, reusing the existing authenticated notice routing taxonomy.
- Added release gate checks for manifest presence, scope/id mismatch, replace-scope
  authorization, target-surface violation, and threshold breaches.
- Integrated `consumer_admission_manifest_path` into
  `import_authenticated_notice_export`; downstream projection/read-model materialization now
  fails closed without a manifest.
- Kept import materialization bounded by the current bundle / selection; a broader
  manifest cannot expand projection or read-model writes beyond the current import
  scope.
- Added worker CLIs:
  - `build_internal_notice_consumer_admission_manifest`
  - `check_internal_notice_consumer_admission_gate`
- Required consumer admission manifest gates for downstream worker entrypoints:
  - `rebuild_internal_notice_consumption_projection`
  - `rebuild_internal_notice_read_model`
  - `repair_internal_notice_read_model_consistency`
  - `drain_internal_notice_pending_multimodal`
- Made the standalone release-gate CLI exit non-zero when the manifest verdict is
  `block`, while still printing the structured gate report.
- Tightened internal notice read model materialization so only
  `notice_level_query + retained_for_notice_query` enters the notice read model.
  Procurement history and campus-services candidates remain projection truth, not
  notice read-model rows.
- Added operator sequence docs for dry-run, manifest generation, standalone gate, and
  bounded materialization.

## Verification

Targeted tests passed:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_consumer_admission_manifest \
  tests.ingestion.test_internal_notice_consumer_admission_builder \
  tests.ingestion.test_internal_notice_consumer_admission_gate \
  tests.ingestion.test_authenticated_notice_import \
  tests.ingestion.test_import_authenticated_notice_export_worker \
  tests.ingestion.test_build_internal_notice_consumer_admission_manifest_worker \
  tests.ingestion.test_check_internal_notice_consumer_admission_gate_worker \
  tests.ingestion.test_internal_notice_read_model \
  tests.ingestion.test_rebuild_internal_notice_consumption_projection_worker \
  tests.ingestion.test_rebuild_internal_notice_read_model_worker \
  tests.ingestion.test_repair_internal_notice_read_model_consistency_worker \
  tests.ingestion.test_drain_internal_notice_pending_multimodal_worker
```

## Explicit Non-Goals

- No live portal collection was run.
- No historical backfill was run.
- No production PG or object-store write was run.
- No chatbot / panel notice query-serving surface was opened.
- No typed campus-services runtime materializer was implemented.

## Remaining Follow-Up

- Future typed materializer owners still need to consume
  `campus_services/*_candidate` projection surfaces through their own release gates.
- Historical backfill remains a separate admitted operation and must start from a
  selected consumer admission manifest.
