---
doc_type: requirements
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Denominator Expansion Requirements

## Objective

Expand the historical regulation denominator using already-collected notices,
then stop at canonical/document-units/chunk quality evidence.

## Scope

- Run14 already-collected regulation-like notice records.
- Body-text owner candidates classified as `ready_for_canonical_chunk_v9`.
- Ingestion-owned owner text source-truth refs in `campus-rag-source`.
- Current regulation canonical materialization and document-units in
  `campus-rag-derived`.
- Chunk-only preparation and quality audit for `institutional_rules` and
  `scoped_rules`.

## Non-Goals

- Do not run new-notice dynamic update flow.
- Do not enqueue or process RAG release candidates.
- Do not create embeddings, indexes, release manifests or aliases.
- Do not mutate serving profile or query allowlist.
- Do not treat reader/document-site readiness as RAG serving readiness.
- Do not promote wrapper notices or incomplete owner-text notices.

## Functional Requirements

- Denominator audit must classify every input notice as ready, recovery,
  duplicate hold, operator excluded, wrapper-summary backlog or already completed.
- Ready candidates must be selected only from body-text owner candidates, not
  wrapper notice bodies.
- Owner text must be extracted and cleaned in ingestion admission before
  canonical materialization; downstream chunk/RAG must not clean raw HTML.
- Source-truth object keys must follow ADR-0002 source bucket convention:
  `authenticated_notice_portal/notice-{id}/{year}/{run_id}/notice-{id}/source-truth/searchable-merge-input.json`.
- Canonical/document-units must follow ADR-0002 derived document convention under
  `regulations/documents/{collection}/...`.
- Scoped rule document-units must preserve `document_nature`,
  `source_notice_release_time`, `cycle_year` and `school_unit_name` when known.
- Chunk preparation must consume registry-backed current document-units.
- Every phase must emit serving-closed and candidate-store-noop assertions.

## Success Criteria

- Phase 00 denominator audit has a stable ready/recovery denominator.
- Ready candidates produce owner-text source-truth refs with no HTML tags.
- Canonical materialization reports `normalization_quality=passed`.
- Chunk preparation passes for admitted targets with no blocked targets.
- Final audit reports zero object-store key failures.
- Evidence contains no embedding, index, release admission, alias publish or
  candidate queue artifacts.
