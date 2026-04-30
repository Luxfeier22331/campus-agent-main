---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 1 Query-Enabled Truth Fix

## Goal

Make query-enabled serving truth consistent across docs, runtime profiles, planning, and Go
runtime policy.

## Requirements

- Decide and freeze `official_web/stable_reference` default query-enabled posture.
- Update all truth locations consistently.
- Keep `regulations/scoped_rules` retrieval-ready but not default query-enabled.
- Add or preserve drift tests that compare runtime profiles and Go policy.

## Implementation Tasks

1. Add/update tests first.
   - `tests/ingestion/test_corpus_runtime_profile.py`.
   - `tests/supervisor/test_query_serving_scope_policy_drift.py`.
   - Go runtime policy tests if the explicit allowlist changes.

2. Update config truth.
   - `configs/ingestion/<scope>/runtime-profile.json`.
   - `configs/runtime/query-serving-scopes.v1.json`.

3. Update docs truth.
   - `docs/architecture/current-architecture.md`.
   - `docs/architecture/system/retrieval-serving-architecture.md`.
   - `docs/reference/runtime-serving-and-index-terms.md`.
   - `.planning/PROJECT.md` only if repo-level current truth text is stale.

4. Verify admission behavior.
   - `default_query_scopes()` matches the Go policy file.
   - `query_enabled_by_default=false` retrieval-ready scopes are excluded.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_corpus_runtime_profile \
  tests.supervisor.test_query_serving_scope_policy_drift
pnpm docs:lint
```

If Go policy files are touched:

```bash
go test ./apps/supervisor-api/internal/runtimepolicy
```

## Done Criteria

- No query-enabled scope drift remains.
- Docs and runtime config name the same default query-enabled set.
- Retrieval-ready default-off scopes remain excluded from default product admission.
