## contact_directory collection config

This directory holds the repo-tracked config scaffolding for the
`contact_directory` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for ingestion plus serving-policy control
- handbook-derived contact pages are canonically declared in
  `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
  and should be selected from handbook source truth via
  `source_title + source_handbook_section + source_page_start/source_page_end`,
  not by requiring a retained `regulations/student_handbook` manifest document

`contact_directory` is the long-term home for structured campus contact content such
as handbook-derived phone pages and future campus contact directories. Its current
runtime profile remains `offline_preparation` and is not part of the default
query-serving surface.
