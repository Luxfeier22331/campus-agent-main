---
doc_type: state
status: completed
workstream: historical-regulation-canonical-chunk-backfill
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Historical Regulation Canonical Chunk Backfill State

## Current Position

**Status:** Completed
**Current Phase:** Phase 36 chunk quality accepted and later-release handoff ready
**Last Activity:** 2026-05-02
**Last Activity Description:** Completed the historical all-regulation v9 rerun:
42 targets were canonicalized with current regulation cleaner v9, admitted to
chunk-only processing, prepared into chunk evidence, independently audited for
object-store key compliance plus chunk quality residuals, and accepted into a
later-release handoff manifest. Object-store canonical/document-units keys were
checked against the ADR-0002 regulation document artifact path. No embedding,
index, release admission, candidate enqueue, candidate processor or alias
publish was run.

## Current Slice

Latest completed evidence:

- Canonical backfill:
  `./evidence/phase-40-canonical-backfill-all-regulations-v9/canonical-backfill-report.json`
- Chunk-only boundary and inventory:
  `./evidence/phase-41-chunk-only-boundary-and-inventory-all-regulations-v9/`
- Chunk preparation:
  `./evidence/phase-42-chunk-preparation-all-regulations-v9/chunk-preparation-batch-report.json`
- Final quality audit:
  `./evidence/phase-42-chunk-preparation-all-regulations-v9/final-quality-audit.json`
- Chunk quality acceptance and handoff:
  `./evidence/phase-36-chunk-quality-acceptance-and-handoff/`

Latest batch result:

- 42 targets canonicalized with
  `collected_notice_regulation_canonical_cleaning_v9`.
- 42 targets admitted to chunk, 0 rejected, 0 needs recovery.
- 29 `institutional_rules` targets and 13 `scoped_rules` targets.
- Chunk preparation prepared 42 documents into 1773 chunks.
- `overall_verdict=passed`; `blocked_target_count=0`;
  `failed_collections=[]`.
- Final audit scanned 1773 chunks and found 0 HTML residual chunks, 0
  publication-imprint chunks, 0 form-tail marker chunks, 0 body-like
  `section_path` chunks, 0 deep `section_path` chunks and 0 coarse
  token-guardrail chunks.
- Final audit found 0 document metric failures and 0 object-store key failures.
- Phase 36 chunk quality acceptance is `passed` and the handoff status is
  `ready_for_separate_release_lane_decision`.
- Serving-closed assertions remain false for query serving, RAG release,
  candidate enqueue, candidate processor, release admission, embedding, index
  release and alias publish.

Object-store naming/path result:

- Current derived bucket: `campus-rag-derived`.
- Current regulation artifact template:
  `regulations/documents/{institutional_rules|scoped_rules}/{title_slug}--{docid8}/current-effective/undated/{canonical.md|document-units.jsonl}`.
- 84 latest canonical/document-units object keys were checked against that
  template: 84 passed, 0 failed.
- `{title_slug}` currently allows CJK human-readable title characters under
  ADR-0002 and existing object-store tests. These regulation paths are compliant
  with the current repo convention; changing to ASCII-only would require a
  separate object-key migration decision.

Current stop point:

- This workstream has completed historical stock canonical/document-units/chunk
  preparation and chunk quality acceptance for the current cohort.
- A later-release handoff manifest has been generated, but it is only an input
  for a separate release-lane decision.
- Any later embedding/index/release work must begin from an explicit new
  release phase; this historical backfill did not open serving.

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

- Latest all-regulation v9 canonical backfill evidence:
  `./evidence/phase-40-canonical-backfill-all-regulations-v9/`
- Latest all-regulation v9 chunk-only inventory evidence:
  `./evidence/phase-41-chunk-only-boundary-and-inventory-all-regulations-v9/`
- Latest all-regulation v9 chunk preparation evidence:
  `./evidence/phase-42-chunk-preparation-all-regulations-v9/`
- Latest chunk quality acceptance and handoff evidence:
  `./evidence/phase-36-chunk-quality-acceptance-and-handoff/`
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

**Stopped At:** Phase 36 chunk quality accepted and later-release handoff ready;
release work remains intentionally unopened
**Resume File:** `./evidence/phase-36-chunk-quality-acceptance-and-handoff/later-release-handoff.json`
