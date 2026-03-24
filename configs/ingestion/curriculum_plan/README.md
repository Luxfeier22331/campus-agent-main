## curriculum_plan ingestion config

This directory holds the repo-tracked config scaffolding for the `curriculum_plan` raw-first ingestion path.

- `runtime-profile.json`: canonical phase-1 runtime truth for ingestion/query gating
- `split-manifest.v1.json`: static page-range truth for splitting one master PDF into logical documents
- `split-manifest.candidate.v1.json`: review companion manifest generated from the same reviewed `structured-full.v3` source
- `split-manifest.candidate.gaps.json`: audit summary for unmatched or retired legacy canonical documents
- `split-manifest.candidate.gap-triage.md`: historical triage plus the resolved governance decision for the retired legacy umbrella document
- `chunk-profile.json`: chunking/runtime profile record for this corpus
- `retrieval-profile.json`: retrieval/runtime profile record for this corpus
- `samples/`: real document-level `structured.jsonl` outputs cut from the reviewed `structured-full.v3` sample

The repo-tracked split manifest now carries the current document list and page-range truth for `curriculum_plan` raw ingestion.

Notes:

- `RAW_INGESTION_ARTIFACT_MODE=provider_only` for pre-split onboarding. This uploads the raw PDF and stores the asset-level `provider-result.jsonl` without requiring a split manifest.
- `RAW_INGESTION_ARTIFACT_MODE=normalized` for document-level ingestion. This requires the split manifest to be filled with the real document list and page ranges before the job is run.

- `split-manifest.v1.json` is now the repo-tracked real split truth for the reviewed `asset:curriculum-plan-2022` sample.
- The formal manifest records logical document boundaries plus document-level ACL/status metadata only. It does not carry an external `source_uri`.
- During normalized ingestion, document `source_uri` is derived from `raw_asset_id + raw_version_id + page_start/page_end`, so registry provenance stays anchored to the master PDF.
- `split-manifest.candidate.v1.json` matches the same `66` real documents and is kept as a review companion artifact.
- `split-manifest.candidate.gaps.json` now records `0` unresolved legacy canonical documents and `1` retired legacy synthetic umbrella document: `各类课程教学计划`.
- Review-only sample outputs still preserve compatibility `source_url` values derived from old canonical doc paths; those values are inspection aids, not the formal split-manifest schema.
- `各类课程教学计划` is intentionally excluded from the formal split manifest because the reviewed source PDF only contains it as body text (`各类课程教学计划由负责单位负责制定。`), not as a source-visible document title.
