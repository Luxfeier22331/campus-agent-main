---
doc_type: requirements
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Canonical Chunk Backfill Requirements

## Objective

Process already collected historical regulation notices into current canonical
and chunk-preparation artifacts without opening downstream RAG release.

The output of this workstream is a reviewable chunk-quality evidence set, not a
serving release.

## Scope

- Already captured notice-derived regulation targets from historical batches.
- `regulations/institutional_rules` and `regulations/scoped_rules` target
  materialization that already passed promotion or manual-review admission.
- Canonical cleaning and normalization using current ingestion-layer policy.
- Document-units as the only chunk source.
- Optional gated reader/preview assets used only for audit or human review.
- Chunk preparation manifests and chunk quality reports.
- Offline evidence under this workstream's evidence directory.

## Non-Goals

- Do not process newly arriving notices through the dynamic release candidate
  lane.
- Do not enqueue `rag_release_candidate` rows.
- Do not call the regulation RAG candidate processor.
- Do not create embeddings, write vector indexes or publish aliases.
- Do not generate release admission manifests.
- Do not change `scoped_rules` query-serving posture.
- Do not treat document-site reader publication as RAG serving readiness.
- Do not mutate existing `rag_release_candidate` state as part of historical
  backfill cleanup.

## Functional Requirements

- Historical targets must be explicitly classified as `admit_to_chunk`,
  `reject` or `needs_recovery` before chunk preparation.
- `admit_to_chunk` requires current canonical cleaning provenance and
  normalization quality evidence.
- Chunk preparation must consume current canonical/document-units artifacts from
  ingestion truth, not stale dry-run materialization JSON.
- Chunk preparation follows the repo term `split -> cleanup -> chunk ->
  validation`; it does not perform embedding, indexing or alias publish.
- Chunk reports must include document identity, target collection, document hash,
  cleaning policy version, chunk profile version and quality verdict.
- Chunk quality validation must fail closed when `section_path` contains body
  text, contextual headers duplicate answer-bearing body text, title chunks
  duplicate the title, body chunks are only structural headings, header tokens
  dominate display text, token guardrail splitting masks coarse document-units,
  page anchors are fabricated, or scoped-rule release time is backfill runtime
  instead of source notice release time.
- The workstream must emit a serving-closed assertion after every runtime batch:
  `query_serving_opened=false`, `rag_release_opened=false`,
  `candidate_enqueue_opened=false`, `candidate_processor_opened=false`,
  `release_admission_opened=false`, `embedding_opened=false`,
  `index_release_opened=false`, `alias_publish_opened=false`.
- Any row that needs owner-body recovery, has only amendment summary text, or is
  historical/search-only must not be promoted beyond its explicit chunk-only or
  rejected status.
- Handoff to the RAG release lane is allowed only after chunk quality is accepted
  and a separate later-release handoff manifest is written.

## Success Criteria

- A selected historical regulation cohort has canonical/document-units artifacts
  rebuilt or verified under current cleaning policy.
- Reader/preview assets, if generated, exist only as audit or human-review
  support, not as proof of RAG serving.
- Chunk preparation completes with auditable quality evidence.
- No dynamic candidate enqueue, embedding, index write or alias publish happens
  in this workstream.
- The downstream release lane can later consume an explicit quality-accepted
  handoff manifest instead of inferring readiness from historical processing.
