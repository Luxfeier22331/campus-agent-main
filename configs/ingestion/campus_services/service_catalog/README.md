## service_catalog collection config

This directory holds the repo-tracked config scaffolding for the
`service_catalog` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for ingestion plus serving-policy control
- `handbook-derived-documents.json`: historical migration input only
- handbook source-truth replay now uses
  `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
  as the canonical declaration of service navigation projections
- handbook-derived service navigation pages should be selected from source truth via
  `source_title + source_handbook_section + source_page_start/source_page_end`,
  not by requiring a retained `regulations/student_handbook` manifest document

Current runtime truth:

- serving stage: `offline_preparation`
- query enabled: `false`
- serving alias: `service_catalog`
- collection prefix: `service_catalog`
- release manifests: `campus_services/releases/service_catalog/{release_id}/...`

`service_catalog` is the long-term home for campus service discovery content such as
internal service entries, directory pages, topic landing pages, and other navigation-
oriented service artifacts. Its current runtime profile remains `offline_preparation`
and is not part of the default query-serving surface. Even in `offline_preparation`,
this collection participates in the release-managed alias lifecycle: Qdrant should
expose a stable `service_catalog` alias that points at versioned physical collections.
