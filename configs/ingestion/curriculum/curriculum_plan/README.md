# curriculum_plan collection config

This directory holds the repo-tracked config scaffolding for the
`curriculum_plan` collection within the `curriculum` corpus.

- `runtime-profile.json`: canonical runtime truth for ingestion/query gating
- `split-manifest.v1.json`: static page-range truth for splitting one master PDF
  into logical documents
- `split-manifest.candidate.v1.json`: review companion manifest generated from
  the same reviewed source
- `split-manifest.candidate.gaps.json`: audit summary for unmatched or retired
  legacy canonical documents
- `split-manifest.candidate.gap-triage.md`: triage notes for the retired legacy
  umbrella document
- `chunk-profile.json`: chunking/runtime profile record for this collection
- `retrieval-profile.json`: retrieval/runtime profile record for this collection
- `samples/`: real document-level sample outputs for chunking and manual review

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
`INGESTION_COLLECTION=curriculum_plan`. Current ingestion must enter through
`apps/ingestion-control` task admission and the collection task registry:

- `source_truth_materialize` for pre-split onboarding. This task materializes
  the raw PDF under
  `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and stores
  asset-level OCR truth under the same canonical source prefix, split by
  `capture/`, `provider/`, and `source-truth/` stages without requiring a
  split manifest. If a follow-up task materializes persisted source-side
  projection outputs, they continue under the sibling
  `projection/<projection_name>/...` stage in the same prefix. This path writes
  `provider-response.jsonl` and `source-truth/layout-elements.jsonl`, but does
  not create document-registry records or per-document artifacts. For
  `curriculum_plan`, the provider lane is collection-owned by
  `runtime-profile.json`; root `OCR_*` defaults do not redefine the canonical
  source OCR truth.
- `document_materialize` for document-level ingestion. This requires the split
  manifest to be filled with the real document list and page ranges before the
  task is admitted and then writes document artifacts under
  `curriculum/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`.
- Historical `REBUILD_IMPORT_MODE=provider_response_replay` Python rebuild is
  retired. Rebuild work must enter through the ingestion-control task registry
  and continue from canonical source truth, canonical document artifacts, or
  `document-units`; missing TS handlers or Rust kernels fail closed instead of
  spawning the old Python CLI path.
- Qdrant indexing writes release-managed physical collections and publishes the
  stable serving alias after validation; object storage keeps only release
  manifests, not chunk dumps.

Notes:

- `split-manifest.v1.json` is the formal repo-tracked split truth for the
  reviewed `asset:curriculum-plan-2022` source.
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
  plus `build_curriculum_chunk_profile(...)`, not from handbook defaults; the
  current frozen runtime is `curriculum_plan_semantic_v2` /
  `curriculum_plan_structure_v2`, keeping `360/540/72/50` for `section_text` and
  applying `420/640/72/64` to `table_unit`.
- current accepted runtime covers section/table reconstruction, caption/note
  grouping, source-truth-derived anchors, and profile-driven serving for
  `curriculum_plan`. Broader `campus_services` taxonomy questions still stay
  inside ingestion-core review scope and do not enable retrieval.
- The formal manifest records logical document boundaries plus ACL/status
  metadata only. Curriculum document `source_uri` is derived during ingestion
  from `raw_asset_id + raw_version_id + page_start/page_end`.
- `split-manifest.candidate.v1.json` remains as a review companion artifact and
  should keep the same document inventory as the formal manifest.
- `samples/index.json` is inspection-only metadata; it should point to the moved
  `configs/ingestion/curriculum/curriculum_plan/samples/...` paths.
