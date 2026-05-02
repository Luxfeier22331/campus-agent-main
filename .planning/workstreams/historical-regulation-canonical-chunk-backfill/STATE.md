---
doc_type: state
status: active
workstream: historical-regulation-canonical-chunk-backfill
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Historical Regulation Canonical Chunk Backfill State

## Current Position

**Status:** Active
**Current Phase:** Phase 5 completed; ingestion-layer rework implemented, rerun required
**Last Activity:** 2026-05-02
**Last Activity Description:** Implemented ingestion-layer fixes for the chunk
quality blockers found in Phase 5. The historical cohort must now rerun
canonical backfill, Phase 0 planning, Phase 4 chunk preparation and Phase 5
quality review before any later-release handoff can be generated.

## Current Slice

Completed runtime evidence:

- Phase 0 inventory/classification/preflight:
  `./evidence/phase-00-chunk-only-boundary-and-inventory/`
- Phase 4 target-limited chunk preparation:
  `./evidence/phase-04-chunk-preparation-batch/`

Current batch result:

- 10 targets admitted to chunk, 0 rejected, 0 needs recovery.
- 2 `institutional_rules` targets and 8 `scoped_rules` targets.
- Canonical provenance preflight passed for all 10 targets.
- Chunk preparation prepared 216 document-units into 302 chunks.
- `institutional_rules` validation passed with 2 documents, 65 units and 79
  chunks.
- `scoped_rules` validation passed with 8 documents, 151 units and 223 chunks.
- Serving closed assertion remains false for query serving, RAG release,
  candidate enqueue, candidate processor, release admission, embedding, index
  release and alias publish.

Remaining slice:

- rerun canonical backfill so historical `document-units` are regenerated with
  the fixed regulation unit contract;
- rerun Phase 0 planning/preflight and Phase 4 chunk preparation against the
  regenerated registry/object-store truth;
- rerun Phase 5 quality review and require all blocking gap counters to be zero;
- only after all targets are accepted, write a later-release handoff manifest.
  Do not generate embeddings, release admission, index release or aliases in
  this workstream.

Chunk quality review evidence:

- `./evidence/phase-05-chunk-quality-review-closeout/chunk-quality-review.json`
- `./evidence/phase-05-chunk-quality-review-closeout/chunk-quality-gap-audit.json`
- `overall_verdict=needs_rework`
- 5 accepted targets, 5 needs-rework targets, 0 rejected targets.
- 22 heading-only body chunks block release handoff.
- 10 title chunks repeat the title line; this is a non-blocking review note.
- Embedding and sparse vector counts remain zero.

Extended gap audit result:

- `overall_verdict=blocking_gaps_found`
- 232 body chunks have `section_path` polluted with article/body text.
- 206 chunks duplicate answer-bearing body text through contextual headers.
- 246 chunks have header tokens dominating display text.
- 3 documents are too coarse at document-units level and rely on token guardrail
  splitting.
- 8 scoped-rule targets carry backfill runtime as `source_notice_release_time`.
- 10 targets have non-informative page anchors and normalization-quality
  `unit_count` mismatch.

Implemented rework:

- regulation article rows now carry `article_label` instead of placing full
  article body text into `section_path`;
- structural heading rows are marked non-answer-bearing and skipped by
  regulation chunk preparation;
- regulation title chunks no longer receive contextual headers that duplicate
  the title;
- institutional/scoped chunk-prep validation now blocks heading-only body
  chunks, body text in section paths, header/body duplicates, title duplicates,
  header-dominant chunks, coarse token-guardrail chunks, fabricated page anchors
  and generated-at release times.

## Decisions Locked

- Historical stock processing is not the same as new notice dynamic update.
- This workstream stops at chunk preparation, chunk quality evidence and a
  later-release handoff decision.
- `rag_release_candidate` lifecycle belongs to `regulation-rag-release-lane`,
  not this workstream.
- Document-units are the chunk input. Reader/preview assets may be produced only
  for audit or human review; reader publish does not imply RAG serving readiness.
- `scoped_rules` remains retrieval-ready but not default query-enabled unless a
  separate architecture decision changes the runtime profile.
- Phase 8 processor replay in `regulation-rag-release-lane` was containment for
  an already-published suspect release; it is not the batch template for this
  historical backfill.

## Known Inputs

- Phase 13 canonical backfill evidence:
  `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/`
- Current regulation RAG release lane evidence:
  `.planning/workstreams/regulation-rag-release-lane/evidence/`
- Promotion quality gate evidence:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/evidence/`

## Verification Plan

Planning-file verification:

```bash
pnpm docs:lint
```

Runtime verification for later phases must include a serving-closed assertion
with these flags:

- `query_serving_opened=false`
- `rag_release_opened=false`
- `candidate_enqueue_opened=false`
- `candidate_processor_opened=false`
- `release_admission_opened=false`
- `embedding_opened=false`
- `index_release_opened=false`
- `alias_publish_opened=false`

## Session Continuity

**Stopped At:** Phase 5 quality review found release-blocking heading-only body chunks
**Resume File:** `./evidence/phase-05-chunk-quality-review-closeout/chunk-quality-review.json`
