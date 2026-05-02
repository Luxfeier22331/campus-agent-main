---
doc_type: plan
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Phase 1-5: Core Implementation

## Goal

Implement the first production-capable slice of the regulation RAG release lane.

## Scope

- Phase 1: candidate contract/store and operator-safe projection.
- Phase 2: materialization handoff from `regulations/*` canonical document changes.
- Phase 3: selected/scheduled pending candidate worker.
- Phase 4: registry-scope release executor that reuses existing chunk preparation,
  retrieval acceptance, alias publish and post-publish audit.
- Phase 5: authenticated notice processing projection and protected panel RAG lane
  status visibility.

## Acceptance

- Candidate lifecycle covers pending, skipped unchanged, non-query-enabled,
  profile-disabled, deleted/tombstone, acceptance failed, verification failed and
  serving published outcomes.
- `institutional_rules` materialization can enqueue query-enabled candidates.
- `scoped_rules` materialization can enqueue candidates while preserving default
  non-serving posture.
- Processing worker can run all pending candidates or selected `candidate_id`s.
- Operator projection separates document site status, RAG preparation, index,
  serving and verification status without exposing raw storage or index payloads.
