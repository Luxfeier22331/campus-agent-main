---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Production Retrieval Observation

## Objective

把 retrieval observation 从 local JSONL debug sink 提升为 durable production intake seam，同时保持
privacy-default、answer-path fail-safe 和 eval/backlog-only semantics。

## Tasks

1. Freeze observation event schema.
2. Keep JSONL as local/debug sink.
3. Add durable sink interface and one repo-owned test adapter.
4. Decide production sink binding after checking current operator observability / app-api ownership docs.
5. Ensure sink failure warns but does not fail answer path.
6. Ensure backend fail-closed, release drift, low-confidence, no-hit, forbidden hit and version mismatch
   produce typed observations.
7. Extend backlog generation to include new failure kinds.

## Verification

- Retrieval service tests for sink/no-sink/failing-sink.
- Privacy tests: raw query absent by default, `query_sha256` present.
- Monitoring backlog tests for all failure classes.
- Targeted docs lint and runbook update.

## Exit Criteria

- Runtime can emit durable sanitized retrieval observations.
- Observation data can feed eval/backlog candidates without mutating release truth.
- Production sink failure cannot take down retrieval answer path.
