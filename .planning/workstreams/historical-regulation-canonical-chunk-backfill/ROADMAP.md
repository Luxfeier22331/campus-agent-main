---
doc_type: roadmap
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Canonical Chunk Backfill Roadmap

## Phases

- [x] **Phase 0: Chunk-Only Boundary And Inventory** - Freeze the no-release
  boundary, enumerate historical regulation targets and define the evidence
  contract for chunk-only processing.
- [x] **Phase 1: Historical Cohort Classification** - Classify each target as
  `admit_to_chunk`, `reject` or `needs_recovery`, with reason codes and source
  evidence.
- [x] **Phase 2: Canonical Provenance Audit** - Verify or rebuild canonical
  markdown/document-units under current cleaning policy and normalization quality
  gates.
- [ ] **Phase 3: Reader/Preview Assets For Audit** - Publish or verify gated
  reader/preview assets only when needed for human review; document-units remain
  the chunk input and serving remains closed.
- [x] **Phase 4: Chunk Preparation Batch** - Run chunk preparation for admitted
  targets and write chunk manifests/reports.
- [x] **Phase 5: Chunk Quality Review Closeout** - Produce accepted/rejected
  chunk-quality decisions and, only for accepted chunks, a downstream handoff
  manifest for a later release phase.

Phase 3 was not required for this batch because Phase 13 canonical artifacts
already passed preflight; reader/preview remains optional audit support and was
not used as chunk input.

Phase 5 produced `needs_rework`, so no later-release handoff was generated.
Five targets are quality-accepted, and five targets must fix or exclude
heading-only body chunks before any embedding/release phase.

## Exit Criteria

- All selected historical targets have an explicit classification.
- All `admit_to_chunk` targets have current canonical cleaning provenance.
- Chunk preparation evidence exists for the admitted cohort.
- Serving-closed assertions prove no candidate enqueue, embedding, index release
  or alias publish occurred.
- Any later RAG release must start from the Phase 5 handoff, not from this
  workstream's intermediate artifacts or candidate-store side effects.
