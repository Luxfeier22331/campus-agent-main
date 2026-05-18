---
doc_type: plan
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Phase 0: Architecture And Design Contract

## Goal

Freeze the target architecture for regulation RAG updates before implementation
begins.

## Changes

- Update target architecture to state reader publish and RAG query-serving are
  separate lanes.
- Update data-plane architecture with `rag_release_candidate` and incremental
  document-units/chunk/index/alias lifecycle.
- Update retrieval serving architecture with candidate batch, acceptance, alias
  publish, rollback/current pointer and operator status semantics.
- Update authenticated notice architecture with downstream regulation RAG status
  projection boundaries.
- Create native workstream planning files for implementation phases.

## Acceptance

- Architecture docs do not say or imply that document site publish equals RAG serving.
- Workstream has README, REQUIREMENTS, ROADMAP, STATE and Phase 0 plan.
- Next implementation phase is clearly scoped to candidate contract/store.
