---
doc_type: plan
phase: phase-02-toolspec-registry-contract
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: ToolSpec Registry Contract

## Goal

Create canonical ToolSpec registry contract and initial registry artifact for all
current read-only tool surfaces.

## Tasks

1. Define ToolSpec fields and schema version.
2. Add initial `configs/runtime/tools.v1.json` registry.
3. Add validation helper and focused tests.
4. Encode later-wave and closed tool posture explicitly.
5. Update docs to point to ToolSpec as canonical tool truth.

## Write Scope

- `configs/runtime/tools.v1.json`
- validation code under the existing runtime config validation owner
- focused tests for ToolSpec validation
- docs contract updates if needed

## Verification

```bash
pnpm yaml:lint
go test ./apps/supervisor-api/internal/runtimepolicy
uv run --all-packages python -m unittest tests.evals.intent_synthetic_suite
pnpm docs:lint
git diff --check
```
