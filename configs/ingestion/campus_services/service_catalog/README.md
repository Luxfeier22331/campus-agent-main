## service_catalog collection config

This directory holds the repo-tracked offline-only config scaffolding for the
`service_catalog` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for offline ingestion only
- `handbook-derived-documents.json`: historical migration input only
- handbook source-truth replay now uses
  `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
  as the canonical declaration of service navigation projections
- handbook-derived service navigation pages should be selected from source truth via
  `source_title + source_handbook_section + source_page_start/source_page_end`,
  not by requiring a retained `regulations/student_handbook` manifest document

`service_catalog` is the long-term home for campus service discovery content such as
internal service entries, directory pages, topic landing pages, and other navigation-
oriented service artifacts. It is not part of the default phase-1 query-serving scope.
