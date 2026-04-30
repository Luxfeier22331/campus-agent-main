---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 8 Acceptance Docs And Closeout

## Outcome

The `canonical-retrieval-release-hardening` workstream is complete.

Closed scope:

- query-enabled truth aligned across runtime / policy / docs
- query-serving alias publish guarded by deterministic retrieval acceptance
- sparse / hybrid release provenance recorded in release manifest and point payload
- chunker / tokenizer / normalizer provenance recorded in preparation manifests
- retrieval runtime drift guard implemented
- deterministic embedding cache and release cost counters implemented
- eval-owned qrels denominator and retrieval tuning report runner implemented
- docs and runbook truth updated for release safety, runtime drift, qrels, tuning, and
  query-enabled scope

## Verification

Focused release/retrieval/eval gate:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service \
  tests.evals.test_retrieval_benchmark \
  tests.evals.test_retrieval_tuning
```

Result: `Ran 279 tests ... OK`.

Docs gate:

```bash
pnpm docs:lint
```

Result: `Summary: 0 error(s)`.

Python lint / format gate:

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

```bash
uv run --all-packages ruff format \
  packages/evals/src/campus_evals/benchmark_tuning.py \
  packages/evals/src/campus_evals/retrieval_tuning.py \
  packages/evals/src/campus_evals/benchmark.py \
  packages/evals/src/campus_evals/benchmark_fixtures.py \
  packages/evals/src/campus_evals/__init__.py \
  tests/evals/retrieval_tuning_suite.py \
  tests/evals/retrieval_benchmark_qrels_module_and_handbook_suite.py \
  tests/evals/retrieval_benchmark_test_support.py \
  tests/evals/test_retrieval_benchmark.py \
  tests/evals/test_retrieval_tuning.py \
  --check
```

Result: `10 files already formatted`.

## Residuals

- No repo-owned implementation blocker remains for this workstream.
- Repo-wide unittest was not used as the completion gate because this dirty worktree has
  unrelated pending changes from other workstreams; this workstream used focused gates over the
  touched release/retrieval/eval surfaces.

## Reopen Rule

Reopen only if one of these happens:

- a query-enabled scope is added without qrels / release acceptance coverage
- release manifest / point payload provenance drifts from runtime profile fields
- runtime drift guard fails to catch a release/profile mismatch
- embedding cache changes provider/model/dimension identity without invalidating cache keys
- retrieval tuning starts mutating production profiles without deterministic passing evidence
