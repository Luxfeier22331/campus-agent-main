---
doc_type: plan
phase: phase-05-provider-function-schema-generation
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Provider Function Schema Generation

## Goal

Generate strict provider-native function schemas from ToolSpec and repo-owned DTO
contracts without leaking provider types into `packages/contracts`.

## Tasks

1. Map ToolSpec payload schema refs to provider function schema output.
2. Enforce strict parameters and no unknown properties.
3. Preserve enums, required fields and bounded descriptions.
4. Add schema snapshots and drift tests.
5. Keep generated provider schema as adapter artifact.

## Write Scope

- provider schema generation helper / script
- schema snapshots
- tests for generated schema stability

## Verification

```bash
uv run --all-packages python -m unittest tests.contracts.canonical_supervisor_execution_schema_suite
uv run --all-packages python -m scripts.generate_supervisor_execution_contracts --check
uv run --all-packages ruff check .
git diff --check
```
