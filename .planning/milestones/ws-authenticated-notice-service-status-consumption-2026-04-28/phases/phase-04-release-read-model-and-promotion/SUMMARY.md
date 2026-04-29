---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 4 Summary: Release Read Model And Promotion

<!-- markdownlint-disable MD013 -->

## Completed

- Aligned service-status publication with preview / stage / promote semantics.
- Verified stage does not move current truth and promote updates PostgreSQL
  current pointer only after release/read-model rows are available.
- Captured live `355650` preview, stage, promote, PG current and PG list
  evidence under the Phase 7 evidence directory.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres
```

Result: covered again in the final Phase 7 verification set.

## Boundaries Preserved

- Runtime truth is the promoted PostgreSQL typed read model.
- Stage artifacts do not become current user-facing truth.
