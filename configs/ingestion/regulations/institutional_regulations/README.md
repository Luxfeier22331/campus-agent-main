## institutional_regulations collection config

This directory holds the repo-tracked config scaffold for the
`institutional_regulations` collection within the `regulations` corpus.

- `runtime-profile.json`: canonical runtime gate for the regulation target collection
- `canonical-profile.json`: canonical identity and provenance truth for promoted regulation documents
- `chunk-profile.json`: chunk-preparation scaffold for canonical regulation text
- `source-projections.v1.json`: promotion-facing projection scaffold from `campus_notices/internal_notice`
- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`: source-side routing scaffold for promotion decisions
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`: freeze that source-triage notices and regulation-owned documents are different collection layers
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`: forward implementation and rollout order for this collection

Current runtime truth:

- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- serving alias: `institutional_regulations`
- collection prefix: `institutional_regulations`

Collection boundary:

- this collection accepts regulation-owned canonical text promoted from source-triage layers
- promoted documents may still carry `document_nature` such as `institutional_regulation`, `annual_cycle_rule`, or `time_bound_operational_rule`
- wrapper notices remain in `campus_notices/internal_notice`
- promotion must preserve provenance back to source notice ids while explicitly separating `source_notice_document_id` from `semantic_owner_document_id`

Current scaffold note:

- this directory no longer only freezes shape: repo now includes a scope-refresh materialization path from `campus_notices/internal_notice` into `regulations/institutional_regulations`
- materialization is currently implemented by:
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/materialize_internal_notice_regulation_candidates.py`
- the current materialization boundary is still `offline_preparation` only
- it still does not enable chunk preparation, embedding, Qdrant write, release, or alias publish

Current materialization truth:

- target `document_id` is derived from `regulation_title_normalized + issuing_org + semantic scope`, not from `notice_id`
- duplicate wrapper/attachment notices that resolve to the same canonical regulation keep one promoted target document while aggregating duplicate provenance in metadata
- scope refresh replaces the full `regulations/institutional_regulations` registry scope on each materialization run
- current internal-notice batch does not split regulation-like text into a second main collection purely because it is annual-cycle or time-bound; those distinctions stay in metadata
