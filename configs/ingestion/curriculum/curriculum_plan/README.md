# curriculum_plan collection config

This directory holds the repo-tracked config scaffolding for the
`curriculum_plan` collection within the `curriculum` corpus.

- `runtime-profile.json`: canonical runtime truth for ingestion/query gating
- `split-manifest.v1.json`: public repo synthetic page-range truth for
  splitting a master PDF into logical documents
- `split-manifest.candidate.v1.json`: review companion manifest with the same
  synthetic document inventory
- `split-manifest.candidate.gaps.json`: audit summary for unmatched or retired
  legacy canonical documents
- `chunk-profile.json`: chunking/runtime profile record for this collection
- `retrieval-profile.json`: retrieval/runtime profile record for this collection
- `samples/`: synthetic document-level sample outputs for chunking and manual
  review

Current runtime truth:

- serving stage: `query_serving`
- query enabled: `true`
- serving alias: `curriculum_plan`
- collection prefix: `curriculum_plan`
- release manifests: `curriculum/releases/curriculum_plan/{release_id}/...`
- source OCR truth: `mineru_api / vlm`
- source parser version: `mineru-vlm-adapted-v2`

The old Python raw-ingestion CLI is no longer an active canonical entry path for
`INGESTION_CORPUS=curriculum` and
`INGESTION_COLLECTION=curriculum_plan`. The active task registry only keeps
executable Rust kernel steps over already-materialized canonical
`document-units`:

- `document_units_validate`
- `chunk_prepare`

Source-truth onboarding, document materialization, structured projection publish,
and alias publish are not active registry tasks for `curriculum_plan`. If any of
those lifecycle steps need to re-enter ingestion-control, add the real TS handler
or Rust kernel bridge and the matching registry entry in the same change.

- For `curriculum_plan`, the provider lane is collection-owned by
  `runtime-profile.json`; root `OCR_*` defaults do not redefine the canonical
  source OCR truth.
- Historical `REBUILD_IMPORT_MODE=provider_response_replay` Python rebuild is
  retired. Rebuild work must enter through the ingestion-control task registry
  and continue from canonical source truth, canonical document artifacts, or
  `document-units`; missing TS handlers or Rust kernels fail closed instead of
  spawning the old Python CLI path.
- Qdrant indexing writes release-managed physical collections and publishes the
  stable serving alias after validation; object storage keeps only release
  manifests, not chunk dumps.

Notes:

- `split-manifest.v1.json` is the repo-tracked synthetic split truth for the
  public repository. Real curriculum source truth and reviewed split manifests
  live in the private data/artifact boundary.
- Current `source-truth/layout-elements.jsonl` rows use
  `schema_version=curriculum_layout_elements_v3`.
- `curriculum_layout_elements_v3` keeps curriculum-specific attachment /
  continuation linkage fields (`owner_row_id`, `relation_type`,
  `continuation_group_id`) while also adopting the shared source-truth core
  hints used by the handbook path, including repeated-candidate, parent-heading,
  cross-page continuation, and table-shape metadata.
- `curriculum_layout_elements_v3` no longer stores `clean_text` or `chunk_id` at
  source-truth level; document text and chunk identity are generated only after
  split/document-level ingestion.
- curriculum `document-units.jsonl` is a structural projection, not a text-only
  flattening. In addition to document-level fields like `doc_id`, `version_id`,
  `chunk_id`, and `clean_text`, the projection must preserve chunking-required
  structural fields from source-truth, including `row_id`, `row_type`,
  `heading_level`, `row_index`, `reading_order`, `section_hint`, `html`,
  `table_cells`, `owner_row_id`, `relation_type`, and `continuation_group_id`.
- because curriculum chunking reconstructs section/table units from
  `document-units.jsonl`, dropping those structural fields in split projection
  is a contract violation, not an acceptable simplification.
- accepted curriculum runtime chunking is loaded from `runtime-profile.json`
  plus this `chunk-profile.json` through TS
  `parseCollectionChunkProfile(...)`, not from handbook defaults or Python
  profile helpers; the current frozen runtime is `curriculum_plan_semantic_v2`
  / `curriculum_plan_structure_v2`, keeping `360/540/72/50` for `section_text`
  and applying `420/640/72/64` to `table_unit`.
- curriculum document-units generation, validation and chunk preparation are
  not owned by Python `curriculum_chunk_units*` or
  `curriculum_document_units*` modules. Runtime execution must enter through
  `apps/ingestion-control` with TS profile parsing and Rust kernel validation /
  chunk preparation.
- current accepted runtime covers section/table reconstruction, caption/note
  grouping, source-truth-derived anchors, and profile-driven serving for
  `curriculum_plan`. Broader `campus_services` taxonomy questions still stay
  inside ingestion-core review scope and do not enable retrieval.
- The formal manifest records logical document boundaries plus ACL/status
  metadata only. Curriculum document `source_uri` is derived during ingestion
  from `raw_asset_id + raw_version_id + page_start/page_end`.
- `split-manifest.candidate.v1.json` remains as a review companion artifact and
  should keep the same synthetic document inventory as the formal manifest.
- `split-manifest.candidate.gaps.json` retains the machine-readable public repo
  audit summary for unmatched / retired legacy canonical documents.
- `samples/index.json` is inspection-only metadata; it should point to the moved
  `configs/ingestion/curriculum/curriculum_plan/samples/...` paths.
