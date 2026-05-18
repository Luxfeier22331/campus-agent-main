---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Large-Scale Release Benchmark

## Objective

提供可重复的 canonical release benchmark，量化 rebuild、embedding、Qdrant indexing、
alias publish 与 query latency，不让成本和容量继续停留在推断层。

## Tasks

1. Design benchmark report schema.
2. Implement benchmark runner with explicit modes:
   - dry-run provider
   - real provider, explicit env admission only
   - synthetic scale multiplier
3. Capture metrics:
   - document / unit / chunk counts
   - token estimates
   - embedding cache hit/miss
   - provider calls / retries
   - Qdrant collection create / index create / upsert / audit timing
   - alias publish timing
   - query p50 / p95 / p99 latency for fixture query set
4. Ensure benchmark cannot bypass release gates or publish alias silently.
5. Add tests for report schema and dry-run benchmark behavior.

## Verification

- Focused benchmark unit tests.
- Dry-run benchmark on a small local fixture.
- Real provider / real Qdrant smoke only when env is available; otherwise record as blocked.

## Exit Criteria

- Benchmark output is machine-readable JSON plus human summary.
- Cost/latency/capacity evidence can be attached to future release review.
- No production alias mutation happens from benchmark mode.
