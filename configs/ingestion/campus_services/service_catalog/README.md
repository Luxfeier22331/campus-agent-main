# service_catalog collection config

This directory holds the repo-tracked config scaffolding for the
`service_catalog` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for ingestion plus
  serving-policy control
- `chunk-profile.json`: canonical generic chunk budget for release-managed
  indexing
- handbook source-truth replay now uses
  `configs/ingestion/regulations/student_rules/source-projections.v1.json` as
  the canonical declaration of service navigation projections
- handbook-derived service navigation pages should be selected from source truth
  via `source_title + source_handbook_section +
  source_page_start/source_page_end`, not by requiring a retained
  `regulations/student_rules` manifest document

Current runtime truth:

- serving stage: `offline_preparation`
- query enabled: `false`
- serving alias: `service_catalog`
- collection prefix: `service_catalog`
- release manifests: `campus_services/releases/service_catalog/{release_id}/...`
- chunk profile: `service_catalog_semantic_v1`

`service_catalog` is the long-term home for campus service discovery content
such as internal service entries, directory pages, topic landing pages, and
other navigation- oriented service artifacts. Its current runtime profile
remains `offline_preparation` and is not part of the default query-serving
surface. Even in `offline_preparation`, this collection participates in the
release-managed alias lifecycle: Qdrant should expose a stable `service_catalog`
alias that points at versioned physical collections.
