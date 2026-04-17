## scoped_rules collection config

This directory holds the repo-tracked config scaffold for the
`scoped_rules` collection within the `regulations` corpus.

- `runtime-profile.json`: canonical runtime gate for the unified scoped-rule holding collection
- `canonical-profile.json`: canonical identity and provenance truth for imported scoped-rule documents
- `chunk-profile.json`: chunk-preparation scaffold for canonical scoped-rule text
- `source-projections.v1.json`: import-facing projection scaffold from `campus_notices/internal_notice`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`: freeze that adjudicated scoped rules should import first into one unified holding collection instead of waiting for full query semantics

Current runtime truth:

- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- serving alias: `scoped_rules`
- collection prefix: `scoped_rules`

Collection boundary:

- this collection accepts canonical scoped rule text only
- current document natures:
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
- wrapper notices remain in `campus_notices/internal_notice`
- stable institution-wide regulations remain in `regulations/institutional_regulations`

Current scaffold note:

- this collection is import-first and query-disabled
- repo now has a completed `materialize_internal_notice_scoped_rules` worker path and a local-only `prepare_scoped_rule_chunks` acceptance path
- target scope refresh must rewrite `document-units/chunks` when provenance metadata expands, even if semantic content hash and version id stay stable
- local-only quality acceptance must use an isolated snapshot root instead of reusing the long-lived historical local-smoke object-store output root
- detailed `current / historical / as_of / compare` semantics are future work and do not block import
