## contact_directory collection config

This directory holds the repo-tracked config scaffolding for the
`contact_directory` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for ingestion plus serving-policy control
- `chunk-profile.json`: canonical generic chunk budget for release-managed indexing
- handbook-derived contact pages are canonically declared in
  `configs/ingestion/regulations/student_rules/source-projections.v1.json`
  and should be selected from handbook source truth via
  `source_title + source_handbook_section + source_page_start/source_page_end`,
  not by requiring a retained `regulations/student_rules` manifest document

Current runtime truth:

- serving stage: `offline_preparation`
- query enabled: `false`
- serving alias: `contact_directory`
- collection prefix: `contact_directory`
- release manifests: `campus_services/releases/contact_directory/{release_id}/...`
- chunk profile: `contact_directory_semantic_v1`

`contact_directory` is the long-term home for structured campus contact content such
as handbook-derived phone pages and future campus contact directories. Its current
runtime profile remains `offline_preparation` and is not part of the default
query-serving surface. Even in `offline_preparation`, this collection participates in
the release-managed alias lifecycle: Qdrant should expose a stable `contact_directory`
alias that points at versioned physical collections.
