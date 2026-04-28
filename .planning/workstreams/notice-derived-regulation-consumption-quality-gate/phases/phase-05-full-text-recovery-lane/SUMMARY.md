---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 5 Summary: Full-Text Recovery Lane

<!-- markdownlint-disable MD013 -->

## Completed

- Added repo-owned owner recovery report for held regulation-like notices.
- Fixed lookup order:
  1. captured attachment child document;
  2. authenticated `file_release_capture`;
  3. `official_web/*` source document;
  4. existing `regulations/*` registry document.
- Recovery rows now store attempted sources, selected source evidence, failure reasons,
  source URI, source document id, and whether the row is source-backed.
- Unresolved owner recovery rows fail closed with `owner_recovery_source_not_found` and keep
  `notice_card_preserved=true`.
- Added worker entry:
  `campus_ingestion_worker.build_internal_notice_regulation_owner_recovery`.
- Updated the regulation promotion runbook with the owner-recovery step and the no-LLM-invention
  rule.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_owner_recovery \
  tests.ingestion.test_build_internal_notice_regulation_owner_recovery_worker -v
```

Result: `5 tests OK`.

## Boundaries Preserved

- Owner recovery does not materialize target regulation rows by itself.
- File-release and official-web sources are evidence/candidate inputs, not regulation collection
  aliases.
- Held notices remain visible through notice-level title/url/card/query when no complete owner
  source is found.
