---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 7 Eval-Driven Retrieval Tuning

## Goal

Make dense/sparse/RRF/no-hit settings evidence-backed per collection.

## Requirements

- Create mini qrels fixtures for opened retrieval collections.
- Evaluate positive recall, MRR, top-k hit, hard negative/no-hit, authz/current-only/version
  behavior.
- Produce profile recommendations without automatically changing production profiles unless the
  deterministic gate passes.
- Supplemental judge/ragas can be diagnostic only.

## Implementation Tasks

1. Define fixture contract.
   - Case id, query, scope, expected docs/versions/chunks, negative expectation, authz context,
     version context.

2. Add eval runner.
   - Suggested location: `packages/evals` if shared, or `packages/ingestion-core` only if tightly
     coupled to release acceptance.
   - Output deterministic JSON report.

3. Add collection mini-sets.
   - `regulations/student_rules`.
   - `regulations/institutional_rules`.
   - `curriculum/curriculum_plan`.
   - `official_web/stable_reference` if default query-enabled remains true.

4. Add tuning sweeps.
   - dense/sparse prefetch limits.
   - RRF k and weights.
   - no-hit thresholds.

5. Update profiles only with evidence.
   - Record before/after metrics.
   - Keep scoped/default-off collections out of default product admission.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals
uv run --all-packages python -m unittest \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service
pnpm docs:lint
```

## Done Criteria

- Each opened retrieval collection has a mini qrels gate.
- Retrieval profile parameters have a report-backed rationale.
- Negative/no-hit behavior is tested, not inferred.
