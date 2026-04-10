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

- this collection only accepts canonical regulation text or stable normative handbook text
- wrapper notices remain in `campus_notices/internal_notice`
- promotion must preserve provenance back to source notice ids and attachment refs

Current scaffold note:

- this directory freezes the target collection shape only
- it does not yet enable promotion execution, chunk preparation, embedding, Qdrant write, or alias publish
