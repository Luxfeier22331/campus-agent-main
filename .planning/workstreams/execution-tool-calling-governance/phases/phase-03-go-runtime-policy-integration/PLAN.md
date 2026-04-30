---
doc_type: plan
phase: phase-03-go-runtime-policy-integration
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Go RuntimePolicy Integration

## Goal

Make Go runtime policy and structured planner derive or verify allowed tool truth
from ToolSpec.

## Tasks

1. Load ToolSpec in Go runtime policy.
2. Replace or drift-guard `AllowedToolsForTarget` and `AllowedToolsForPayloadKind`.
3. Fail closed on unknown tool, wrong owner, missing payload kind or version drift.
4. Add planner tests proving selected target and allowed tools remain stable.
5. Keep opening gate behavior unchanged.

## Write Scope

- `apps/supervisor-api/internal/runtimepolicy/`
- `apps/supervisor-api/internal/structuredplanning/`
- relevant Go tests

## Verification

```bash
cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning
pnpm docs:lint
git diff --check
```
