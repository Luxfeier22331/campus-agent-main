## institutional_rules collection config

This directory holds the repo-tracked config scaffold for the
`institutional_rules` collection within the `regulations` corpus.

- `runtime-profile.json`: canonical runtime gate for the regulation target collection
- `canonical-profile.json`: canonical identity and provenance truth for promoted regulation documents
- `chunk-profile.json`: chunk-preparation contract for canonical regulation text
- `source-projections.v1.json`: promotion-facing projection scaffold from `campus_notices/internal_notice`
- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`: source-side routing scaffold for promotion decisions
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`: freeze that source-triage notices and regulation-owned documents are different collection layers
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`: target identity and acceptance truth
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`: local-only target acceptance operator path

Current runtime truth:

- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- serving alias: `institutional_rules`
- collection prefix: `institutional_rules`

Collection boundary:

- this collection accepts regulation-owned canonical text promoted from source-triage layers
- promoted documents may still carry `document_nature` such as `institutional_regulation`, `annual_cycle_rule`, or `time_bound_operational_rule`
- wrapper notices remain in `campus_notices/internal_notice`
- promotion must preserve provenance back to source notice ids while explicitly separating `source_notice_document_id` from `semantic_owner_document_id`

Current scaffold note:

- this directory no longer only freezes shape: repo now includes a scope-refresh materialization path from `campus_notices/internal_notice` into `regulations/institutional_rules`
- materialization is currently implemented by:
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/materialize_internal_notice_regulation_candidates.py`
- local-only target acceptance chunk preparation is currently implemented by:
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_institutional_regulation_chunk_prep.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/prepare_institutional_regulation_chunks.py`
- the current boundary is still `offline_preparation` only
- it still does not enable embedding, Qdrant write, release, or alias publish

Current materialization truth:

- target `document_id` is derived from `regulation_work_title + issuing_org + semantic scope`, not from `notice_id`
- projected/materialized `title` now uses `regulation_display_title` when available
- current execution preserves these regulation title/version metadata fields:
  - `regulation_work_title`
  - `regulation_edition_label`
  - `regulation_display_title`
  - `source_title_literal`
- `regulation_title_normalized` remains as normalized source-facing title metadata
- duplicate wrapper/attachment notices that resolve to the same canonical regulation keep one promoted target document while aggregating duplicate provenance in metadata
- scope refresh replaces the full `regulations/institutional_rules` registry scope on each materialization run
- annual-cycle and time-bound rules no longer stay in this collection as target scope; they materialize into `regulations/scoped_rules`

Display convention note:

- ADR-0040 freezes the long-term split between `regulation_work_title`, `regulation_edition_label`, and `regulation_display_title`
- the slash form `<work title> / <edition label>` is a repo-local display convention inferred from work/version separation needs; it is not presented as a literal external metadata standard
- `regulation_display_title` keeps the full `edition_label` semantics instead of collapsing to a bare year
  - `... / 2026版` and `... / 2026年修订` are valid current forms
  - `... / 2026` is not the current accepted display-title format
- year-bearing but non-edition signals such as `2026届`, status qualifiers such as `暂行/试行`, and file-number signals such as `民大校发〔2025〕104号` must not be reclassified as `regulation_edition_label`
