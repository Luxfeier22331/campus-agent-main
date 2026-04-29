# curriculum_plan split candidate notes

This note records the current repo-tracked `cleaning -> split` decision state
for the reviewed `curriculum-plan-2022` asset.

## Repo facts

- formal `split_manifest.py` currently requires:
  - non-empty `raw_asset_id`
  - unique `document_id`
  - non-overlapping page ranges
- the formal split manifest does not store an external `source_uri`
- normalized raw ingestion derives document `source_uri` from `raw_asset_id +
  raw_version_id + page_start/page_end`
- `/tmp/curriculum-layout-elements.v3.jsonl` contains the reviewed source-truth
  rows used for this split review
- old `campusRag` curriculum canonical docs provide reusable:
  - `doc_id`
  - `title`
  - `status`
  - `pages_span`
  - `source_refs`
- old `campusRag` canonical metadata is not sufficient as the formal split truth
  because:
  - legacy `pages_span` values overlap
  - canonical compatibility `source_uri` values are not the phase-1 formal
    manifest contract on this branch

## Current candidate result

- `split-manifest.v1.json`
  - promoted to the real split truth for the reviewed
    `asset:curriculum-plan-2022`
  - `69` title-anchored documents
  - page ranges inferred from current `layout-elements.v3` title occurrences
    after minimal title normalization
- `split-manifest.candidate.v1.json`
  - review companion artifact generated from the same source and document list
  - follows the same repo manifest schema as the formal split truth
- `split-manifest.candidate.gaps.json`
  - `0` unresolved legacy canonical documents
  - `1` retired legacy canonical document: `各类课程教学计划`
  - retirement reason: `legacy_synthetic_umbrella_title`
- `samples/*.structured.jsonl`
  - real document-level outputs cut from the current reviewed
    `layout-elements.v3`
  - intended for split-shape inspection only
  - retain compatibility `source_url` values derived from canonical doc paths
    for review convenience

## Governance decision

`各类课程教学计划` is not carried into the formal split manifest.

Reason:

1. the reviewed source PDF does not expose it as a real document title
1. the cleaned source only preserves it as body text: `各类课程教学计划由负责单位负责制定。`
1. the next real source-visible titles start at `中央民族大学通识课程教学计划` and
   `中央民族大学通识课程思想政治理论课教学计划`

Result:

1. `missing_documents` is expected to stay empty for the reviewed seed result
1. the legacy umbrella record is tracked as a retired canonical artifact, not a
   split gap
1. the formal split truth remains anchored only on source-visible titles
