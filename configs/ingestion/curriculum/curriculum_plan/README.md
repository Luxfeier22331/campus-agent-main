## curriculum_plan collection config

This directory holds the repo-tracked config scaffolding for the `curriculum_plan`
collection within the `curriculum` corpus.

- `runtime-profile.json`: canonical phase-1 runtime truth for ingestion/query gating
- `split-manifest.v1.json`: static page-range truth for splitting one master PDF into logical documents
- `split-manifest.candidate.v1.json`: review companion manifest generated from the same reviewed source
- `split-manifest.candidate.gaps.json`: audit summary for unmatched or retired legacy canonical documents
- `split-manifest.candidate.gap-triage.md`: triage notes for the retired legacy umbrella document
- `chunk-profile.json`: chunking/runtime profile record for this collection
- `retrieval-profile.json`: retrieval/runtime profile record for this collection
- `samples/`: real document-level sample outputs for chunking and manual review

`process_raw_ingestion_job` supports two phase-1 entry paths for
`INGESTION_CORPUS=curriculum` and `INGESTION_COLLECTION=curriculum_plan`:

- `RAW_INGESTION_ARTIFACT_MODE=source_truth_only` for pre-split onboarding. This uploads the raw PDF under `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and stores asset-level OCR truth under the same canonical source prefix, split by `capture/`, `provider/`, and `source-truth/` stages without requiring a split manifest. This path writes `provider-response.jsonl` and `source-truth/layout-elements.jsonl`, but does not create document-registry records or per-document artifacts.
- `RAW_INGESTION_ARTIFACT_MODE=normalized` for document-level ingestion. This requires the split manifest to be filled with the real document list and page ranges before the job is run and then writes document artifacts under `curriculum/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`.

Notes:

- `split-manifest.v1.json` is the formal repo-tracked split truth for the reviewed `asset:curriculum-plan-2022` source.
- Current `source-truth/layout-elements.jsonl` rows use `schema_version=curriculum_layout_elements_v3`.
- `curriculum_layout_elements_v3` keeps curriculum-specific attachment / continuation linkage fields (`owner_row_id`, `relation_type`, `continuation_group_id`) while also adopting the shared source-truth core hints used by the handbook path, including repeated-candidate, parent-heading, cross-page continuation, and table-shape metadata.
- `curriculum_layout_elements_v3` no longer stores `clean_text` or `chunk_id` at source-truth level; document text and chunk identity are generated only after split/document-level ingestion.
- The formal manifest records logical document boundaries plus ACL/status metadata only. Curriculum document `source_uri` is derived during ingestion from `raw_asset_id + raw_version_id + page_start/page_end`.
- `split-manifest.candidate.v1.json` remains as a review companion artifact and should keep the same document inventory as the formal manifest.
- `samples/index.json` is inspection-only metadata; it should point to the moved `configs/ingestion/curriculum/curriculum_plan/samples/...` paths.
