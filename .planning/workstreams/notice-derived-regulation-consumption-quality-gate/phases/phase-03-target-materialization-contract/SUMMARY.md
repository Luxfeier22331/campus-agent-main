---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 3 Summary: Target Materialization Contract

<!-- markdownlint-disable MD013 -->

## Completed

- Confirmed `institutional_rules` and `scoped_rules` target materializers read existing
  `notice_consumption_projection` entries only.
- Preserved regression coverage that downstream materializers do not rebuild the regulation
  promotion manifest or source-truth projection.
- Added selected-refresh stale target cleanup for zero-candidate requests:
  - held / rejected selected notices remove target rows previously derived from that selected
    notice;
  - unrelated target rows in the same `regulations/*` scope are preserved.
- Added shared target-scope provenance reader for materialized notice-derived targets:
  `document-units` metadata is used to match `source_notice_ids` and source document lineage.
- Added scoped-rule test imports to the canonical `test_internal_notice_scoped_rule_materialization`
  unittest entry so scoped materialization suites run in targeted and discoverable lanes.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_materialization \
  tests.ingestion.test_internal_notice_scoped_rule_materialization -v
```

Result: `19 tests OK`.

## Boundaries Preserved

- Held notices stay notice-level/query-card material, not `regulations/*` target material.
- Target materializers do not call projection rebuild or promotion manifest rebuild.
- Source-truth `campus_notices/internal_notice` records are not deleted during target cleanup.
