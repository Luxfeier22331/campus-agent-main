---
doc_type: phase_plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Retrieval Runtime Observation Bridge

Status: completed on 2026-05-01.

## Goal

Connect `retrieval.runtime_observation` to OTel-compatible runtime telemetry without adding OTel
dependencies to `retrieval-core`.

## Tasks

1. Locate the current `supervisor-agent-worker` retrieval execution boundary.
2. Add a runtime adapter that receives retrieval observations and emits sanitized OTel-compatible
   events/logs/spans.
3. Map allowed fields and drop forbidden raw text fields.
4. Derive low-cardinality metrics for no-hit, low-confidence, release drift and reranker degraded.
5. Add tests for success, no-hit, drift, degraded fallback, sink failure and raw-query absence.

## Acceptance

- Retrieval answer path works with no sink, JSONL sink and runtime event sink.
- Sink failure is warning-only.
- `packages/retrieval-core` has no OTel imports.
