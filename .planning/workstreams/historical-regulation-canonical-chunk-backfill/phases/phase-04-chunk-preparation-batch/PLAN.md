---
doc_type: phase_plan
status: completed
workstream: historical-regulation-canonical-chunk-backfill
phase: phase-04-chunk-preparation-batch
created: 2026-05-02
updated: 2026-05-02
---
# Phase 4: Chunk Preparation Batch

## Goal

Run chunk preparation for the Phase 0 admitted historical regulation cohort and
write reviewable chunk quality evidence without opening any downstream RAG
release path.

## Execution Boundary

This phase uses the historical target-limited worker:

```bash
uv run --all-packages \
  campus-ingestion-prepare-historical-regulation-chunk-backfill
```

It must not use collection-wide registry scope preparation because that command
selects the current collection scope rather than the historical cohort.

## Runtime Evidence

Produced under:

`.planning/workstreams/historical-regulation-canonical-chunk-backfill/evidence/phase-04-chunk-preparation-batch/`

Observed result:

- `chunk-preparation-batch-report.json`: `overall_verdict=passed`.
- 10 historical targets prepared.
- 2 `institutional_rules` targets prepared from 65 document-units into 79
  chunks.
- 8 `scoped_rules` targets prepared from 151 document-units into 223 chunks.
- Batch total: 216 document-units and 302 chunks.
- `serving-closed-assertion.json`: query serving, RAG release, candidate enqueue,
  candidate processor, release admission, embedding, index release and alias
  publish remain false.
- `candidate-store-noop-assertion.json`: no candidate-store mutation.

## Non-Release Proof

This phase did not run:

- `campus-ingestion-enqueue-regulation-rag-release-candidates`
- `campus-ingestion-process-regulation-rag-release-candidates`
- `campus-ingestion-release-registry-scope`
- `campus-ingestion-scope-alias`

It also did not create embeddings, write vector indexes, generate release
admission manifests or publish aliases.
