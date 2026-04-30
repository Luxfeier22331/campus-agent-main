---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Reranker Adoption Gate

## Objective

建立从 deterministic rerank eval 到 runtime profile opt-in 的受控路径，避免无证据地全局打开
reranker。

## Tasks

1. Define reranker candidate set size and timeout/cost budgets.
2. Extend eval report to compare baseline hybrid/RRF with reranked result.
3. Add adoption threshold contract:
   - quality improves or no material regression
   - latency within budget
   - cost within budget
   - no authz / version / citation regression
4. Add runtime profile opt-in field and provenance if needed.
5. Implement fallback posture:
   - reranker timeout / provider failure returns baseline
   - degraded observation emitted
6. Update runbook: reranker is profile-gated, not a global default.

## Verification

- Eval tests for before/after metric calculation and threshold decisions.
- Runtime tests for opt-in, opt-out, timeout fallback and degraded observation.
- Release profile drift tests if new profile fields affect release metadata.

## Exit Criteria

- Reranker cannot run in production without deterministic collection-level evidence.
- Fallback preserves answer path and observability.
- Tuning still cannot auto-mutate runtime profile.
