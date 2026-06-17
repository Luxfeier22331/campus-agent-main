# contact_directory collection config

This directory holds the repo-tracked config scaffolding for the
`contact_directory` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for ingestion plus
  serving-policy control
- `chunk-profile.json`: canonical generic chunk budget for release-managed
  indexing
- handbook-derived contact pages are canonically declared in
  `configs/ingestion/regulations/student_rules/source-projections.v1.json` and
  should be selected from handbook source truth via `source_title +
  source_handbook_section + source_page_start/source_page_end`, not by requiring
  a retained `regulations/student_rules` manifest document

Current runtime truth:

- serving stage: `structured_query_serving`
- query enabled: `false`
- structured query enabled: `true` via `contact_directory_lookup`
- serving alias: `contact_directory`
- collection prefix: `contact_directory`
- release manifests:
  `campus_services/releases/contact_directory/{release_id}/...`
- structured projection artifact:
  `campus_services/releases/contact_directory/{release_id}/contact-directory-projection.json`
- chunk profile: `contact_directory_semantic_v1`

`contact_directory` is the long-term home for structured campus contact content
such as handbook-derived phone pages and future campus contact directories. Its
current runtime profile is `structured_query_serving` and is not part of the
default generic retrieval query-serving surface. It participates in the
release-managed alias lifecycle: Qdrant should expose a stable
`contact_directory` alias that points at versioned physical collections.

Current structured projection:

- schema: `campus_services_contact_directory_projection.v1`
- source truth: handbook cleanup `document-units.jsonl` for
  `中央民族大学校内常用电话`
- canonical build path: `regulations/student_rules` handbook raw ingestion and
  source-truth projection tasks consume `source-projections.v1.json`,
  materialize `campus_services/contact_directory` document artifacts, and
  publish the structured projection release in the same admitted run
- debug/recovery path: admit an ingestion-control `ts_control` projection task
  with explicit source-truth inputs; no Python collection worker command is
  retained
- data contract:
  `docs/data/campus-services-contact-directory-source-truth-schema.md`

This projection opens only the typed structured runtime path for
`contact_directory_lookup`. It does not open retrieval or add
`contact_directory` to the default query-serving alias surface.
