# scoped_rules collection config

This directory holds the repo-tracked config scaffold for the `scoped_rules`
collection within the `regulations` corpus.

- `serving-config.json`: canonical serving gate for the unified scoped-rule
  holding collection
- `canonical-profile.json`: canonical identity and provenance truth for imported
  scoped-rule documents
- `chunk-profile.json`: chunk-preparation scaffold for canonical scoped-rule
  text
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`: freeze
  that adjudicated scoped rules should import first into one unified holding
  collection instead of waiting for full query semantics

Current serving truth:

- serving stage: `query_serving`
- retrieval enabled: `true`
- query enabled by default: `false`
- serving alias: `scoped_rules`
- collection prefix: `scoped_rules`
- downstream admission policy: excluded from current document-site read-model and
  RAG release candidate admission; historical backfills may only prepare
  canonical/document-units/chunk-only evidence

Collection boundary:

- this collection accepts canonical scoped rule text only
- current document natures:
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
- wrapper notices remain in `campus_notices/internal_notice`
- stable institution-wide regulations remain in
  `regulations/institutional_rules`
- clearly historical annual-cycle notices remain in
  `campus_notices/internal_notice` with `promotion_disposition=hold_in_internal_notice`

Current scaffold note:

- this collection is canonical/chunk-preparation ready, but query disabled by
  default and excluded from document-site/RAG downstream consumption
- repo no longer keeps a Python scoped-rule materialization or local chunk-prep
  path. Active execution starts from explicit canonical `document-units` refs and
  uses the registry-declared Rust validation/chunk kernels.
- selected historical scoped-rule inputs may only be reintroduced by adding a
  real `ts_control` document materializer or Rust kernel bridge in the same
  change as its task-registry entry.
- `annual_cycle_rule` candidates must pass applicability gating before target
  materialization; expired unit/year-specific annual cycle notices are retained
  for notice-level query rather than published to the regulation reader
- target scope refresh must rewrite `document-units/chunks` when provenance
  metadata expands, even if semantic content hash and version id stay stable
- local-only quality acceptance must use an isolated snapshot root instead of
  reusing the long-lived historical local-smoke object-store output root
- detailed `current / historical / as_of / compare` semantics are future work
  and do not block import
