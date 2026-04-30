---
doc_type: plan
phase: phase-06-tool-call-lifecycle-observability
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Tool Call Lifecycle And Observability

## Goal

Standardize tool call lifecycle projection, audit fields and bounded result
projection semantics.

## Tasks

1. Define tool call lifecycle fields.
2. Add sanitized argument summary and result projection policy.
3. Wire workflow trace / execution audit / metrics summaries.
4. Ensure raw function response and raw provider trace do not leak.
5. Add observability and snapshot tests.

## Write Scope

- `apps/supervisor-api/internal/execution/`
- `apps/supervisor-api/internal/executionaudit/`
- `apps/supervisor-api/internal/observability/`
- `packages/evals` trace fixtures if needed

## Verification

```bash
cd apps/supervisor-api && go test ./internal/execution ./internal/executionaudit ./internal/observability
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite
git diff --check
```
