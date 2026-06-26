---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-06-27
updated: 2026-06-27
---
# Internal Notice PDF Chunks

## Boundary

This document freezes the minimum sample-set contract for PDF chunk tuning in
`campus_notices/internal_notice`.

Scope:

- `corpus=campus_notices`
- `collection=internal_notice`
- `lane=attachment_ocr_required`
- `asset_family=pdf`

It does not open `internal_notice` query-serving and does not define final chunk
parameters.

## Frozen Input

Chunk tuning consumes frozen pre-chunk canonical truth:

- `document-units.jsonl` is the direct tuning input.
- `layout-elements.jsonl` and `canonical.md` stay available for review and
  failure analysis.
- raw PDF bytes stay available for parser/provider regression, not direct chunk
  parameter scanning.

The sample unit is one materialized PDF child document. Each sample must link
back to:

- `document_id`
- `parent_document_id`
- `attachment_ref_id`
- raw source asset provenance

## Storage Boundary

Sample sets are operations truth, not document truth or release truth.

Use an operations prefix shaped like:

`campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/`

Each sample set should include:

- `sample-set-manifest.json`
- `queries.jsonl`
- `samples/{sample_id}/sample-manifest.json`
- `samples/{sample_id}/raw.pdf`
- `samples/{sample_id}/provider-response.jsonl`
- `samples/{sample_id}/layout-elements.jsonl`
- `samples/{sample_id}/canonical.md`
- `samples/{sample_id}/document-units.jsonl`

Do not write sample-set files into `campus_notices/documents/` or
`campus_notices/releases/`.

## Not Frozen

These are eval outputs and must not become sample-set truth:

- chunks
- embeddings
- vector collections
- rerank cache
- retrieval response cache

Eval outputs should use a separate operations prefix:

`campus_notices/operations/chunk-tuning-evals/{eval_run_id}/internal_notice/attachment_ocr_required/`

## Query Truth

`queries.jsonl` must freeze query cases with enough evidence to diagnose chunk
failures:

- stable `query_id`
- `sample_id`
- question text
- expected answer type
- page / section / snippet-level `gold_evidence`
- optional `must_not_retrieve` entries for cover pages, tables of contents, or
  header-dominant failures

## Versioning

Create a new `sample_set_version` when parser/provider routing,
`layout-elements.jsonl`, `document-units.jsonl`, or pre-chunk unit semantics
change.

Do not create a new sample set for ordinary parameter experiments such as
`chunk_size`, `max_chunk_size`, `chunk_overlap`, or post-chunk ranking changes.
