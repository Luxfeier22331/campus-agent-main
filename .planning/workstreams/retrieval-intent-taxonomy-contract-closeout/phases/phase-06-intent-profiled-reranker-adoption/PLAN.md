---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 6: Runtime-Profile Reranker With Intent Eligibility

## Goal

Keep reranker adoption runtime-profile owned, and add intent-derived eligibility so supported
intent/profile combinations can opt in without creating a global default.

## Scope

- Reranker eligibility fields projected from intent.
- Existing runtime profile adoption fields.
- Eval evidence id requirement.
- Runtime degraded telemetry.

## Implementation Tasks

1. Add intent-derived reranker eligibility projection used by rag-agent/retrieval plan execution.
2. Keep default global reranker off unless the runtime profile explicitly enables it.
3. Require adoption evidence id in profile patch.
4. Ensure intent eligibility can only narrow runtime profile opt-in, not override it.
5. Update reranker eval and runtime tests.

## Acceptance Criteria

- reranker cannot be enabled without runtime profile gate and intent eligibility.
- enabled paths carry eval evidence id and degraded telemetry.
- non-enabled paths remain unchanged.
- `RetrievalIntent.expected.rerank_policy` can only narrow runtime profile opt-in.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.backend_qdrant_release_guard_suite \
  tests.evals.retrieval_rerank_eval_suite \
  tests.evals.retrieval_monitoring_suite -q
uv run --all-packages ruff check packages/retrieval-core packages/evals tests/evals
uv run --all-packages ruff format <changed-python-files> --check
```
