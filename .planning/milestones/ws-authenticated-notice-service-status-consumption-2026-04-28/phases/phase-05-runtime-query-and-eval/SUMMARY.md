---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 5 Summary: Runtime Query And Eval

<!-- markdownlint-disable MD013 -->

## Completed

- Verified `service_status_lookup` reads the promoted PostgreSQL current typed
  read model.
- Added runtime routing/planning coverage for natural bathroom prompts such as
  `静园10号楼女浴室现在开放吗`.
- Preserved fail-closed behavior for missing current truth instead of falling
  back to raw notice scan or generic RAG.

## Verification

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

Run from `apps/supervisor-api`.

```bash
uv run --all-packages python -m unittest tests.evals.intent_synthetic_suite
```

Result: both commands passed in the final Phase 7 verification set.

## Boundaries Preserved

- Runtime lookup remains projection-backed.
- Routing changes are service-status specific and do not open adjacent notice
  families.
