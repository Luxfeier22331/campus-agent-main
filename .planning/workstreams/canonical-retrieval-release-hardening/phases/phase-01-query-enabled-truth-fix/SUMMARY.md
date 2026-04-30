---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 1 Query-Enabled Truth Fix

## Result

Phase 1 kept `official_web/stable_reference` as a default query-enabled surface and aligned the
architecture / planning wording with runtime truth.

Default query-enabled scopes are now consistently documented as:

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

`regulations/scoped_rules` remains retrieval-ready and default-off. `campus_services/*` remains
`offline_preparation`.

## Changes

- Updated `docs/architecture/current-architecture.md`.
- Updated `docs/architecture/system/retrieval-serving-architecture.md`.
- Updated `docs/reference/runtime-serving-and-index-terms.md`.
- Updated `.planning/PROJECT.md`.

No runtime config change was needed: runtime profiles and
`configs/runtime/query-serving-scopes.v1.json` already listed the same four default
query-enabled scopes, and drift tests already compare those two truths.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_corpus_runtime_profile \
  tests.supervisor.test_query_serving_scope_policy_drift
```

Result: `Ran 24 tests in 0.009s` / `OK`.

```bash
pnpm docs:lint
```

Result: `Summary: 0 error(s)`.
