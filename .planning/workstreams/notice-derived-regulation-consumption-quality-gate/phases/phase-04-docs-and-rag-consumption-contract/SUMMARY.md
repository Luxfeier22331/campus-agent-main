---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 4 Summary: Docs And RAG Consumption Contract

<!-- markdownlint-disable MD013 -->

## Completed

- Added docs reader publisher scope guard: only approved canonical document scopes can produce
  reader assets and docs read-model manifests.
- Added `app-api` docs read-model manifest import guard for the same approved scope set.
- Locked negative import coverage for `campus_notices/internal_notice`: source notice records
  cannot be imported as full docs read-model documents.
- Added notice read-model coverage proving a held regulation-like notice remains queryable as a
  notice-level title/url/card row.
- Added chunk-prep coverage proving `institutional_rules` and `scoped_rules` RAG preparation
  ignore `campus_notices/internal_notice` source records.
- Updated runbooks so document-site/docs read-model/RAG preparation consume target canonical
  `regulations/*` records only; held / partial source notices stay notice-level card/query
  material.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_read_model \
  tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep \
  tests.ingestion.test_internal_notice_scoped_rule_chunk_prep -v
```

Result: `19 tests OK`.

```bash
pnpm --filter app-api exec vitest run -c vitest.node.config.mts \
  test/docs.read-model-manifest.test.ts
```

Result: `1 file / 2 tests passed`.

## Boundaries Preserved

- `campus_notices/internal_notice` remains source/card/query material, not document-site target
  material.
- Held amendment-summary notices remain searchable by title/url through notice read model.
- RAG/chunk-prep consumes only `regulations/institutional_rules` and
  `regulations/scoped_rules` target canonical records.
