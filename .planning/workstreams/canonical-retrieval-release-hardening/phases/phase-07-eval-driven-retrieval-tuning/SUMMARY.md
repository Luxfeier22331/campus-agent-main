---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 7 Eval-Driven Retrieval Tuning

## Outcome

Phase 7 is complete for repo-owned deterministic tuning infrastructure.

Default query-enabled retrieval scopes now have qrels fixtures:

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

`packages/evals` now owns retrieval tuning reports. The runner evaluates observed candidate
run-results against qrels, computes positive hit / recall / MRR, no-hit behavior,
forbidden-source hits, version-locked recall, and emits `recommended_profile_patch` only when a
candidate passes deterministic gates.

## Implementation

- Added `campus_evals.benchmark_tuning`.
- Added `campus_evals.retrieval_tuning` CLI.
- Added `institutional_rules_retrieval_qrels.json`.
- Added `configs/ingestion/regulations/institutional_rules/retrieval-eval-manifest.v1.json`.
- Extended qrels manifest resolution to support `retrieval-eval-manifest.v1.json` for
  projection-derived scopes without a static split manifest.
- Exported retrieval tuning models/helpers from `campus_evals.benchmark` and package root.
- Documented the retrieval tuning CLI and candidate-run schema in `packages/evals/README.md`.

## Boundaries

- Tuning reports do not mutate production `runtime-profile.json`.
- Tuning does not expand query-enabled scopes.
- `packages/ingestion-core` remains a consumer of deterministic reports only; qrels and tuning
  runner logic stay under `packages/evals`.
- Supplemental judge/RAGAS metrics remain diagnostic and are not part of this deterministic
  profile recommendation gate.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.test_retrieval_benchmark tests.evals.test_retrieval_tuning
```

Result: `Ran 85 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/evals/src/campus_evals/benchmark_tuning.py \
  packages/evals/src/campus_evals/retrieval_tuning.py \
  packages/evals/src/campus_evals/benchmark.py \
  packages/evals/src/campus_evals/benchmark_fixtures.py \
  packages/evals/src/campus_evals/__init__.py \
  tests/evals/retrieval_tuning_suite.py \
  tests/evals/retrieval_benchmark_qrels_module_and_handbook_suite.py \
  tests/evals/retrieval_benchmark_test_support.py \
  tests/evals/test_retrieval_benchmark.py \
  tests/evals/test_retrieval_tuning.py
```

Result: `All checks passed!`.
