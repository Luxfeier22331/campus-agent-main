---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Eval, Observability And Closeout

## Goal

Make harness behavior regression-safe and complete the workstream.

## Tasks

1. Add harness-level eval fixture denominator.
2. Extend workflow trace gate to cover artifact graph:
   - expected artifacts
   - selected producers
   - selected tools
   - dependencies
   - projection completeness
   - final answer usage
   - fail-close reason
3. Update architecture docs.
4. Add `GAP-LEDGER.md`.
5. Run focused and docs verification.

## Exit Criteria

- Workstream can be marked completed.
- Future composite capabilities have an explicit admission checklist.

## Verification

```bash
pnpm docs:lint
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/runtimepolicy ./internal/execution ./internal/httpapi
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q
git diff --check
```
