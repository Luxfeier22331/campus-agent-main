---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 2 Summary: Projection Contract And Schema

<!-- markdownlint-disable MD013 -->

## Completed

- Extended service-status projection contract around typed service records,
  rejected-source reporting and source provenance.
- Preserved typed read-model semantics where runtime reads PostgreSQL current
  release rows instead of raw notice body or object-store current JSON.
- Kept runtime/storage details out of cross-package product contracts.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_structured_projection_postgres
```

Result: covered again in the final Phase 7 verification set.

## Boundaries Preserved

- Invalid or incomplete service-status records fail before publication.
- Source notice refs remain provenance, not query-time runtime input.
