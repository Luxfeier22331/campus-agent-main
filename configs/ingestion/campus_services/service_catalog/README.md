## service_catalog collection config

This directory holds the repo-tracked offline-only config scaffolding for the
`service_catalog` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for offline ingestion only
- `handbook-derived-documents.json`: source-level derivation truth for handbook pages
  that should materialize as service navigation documents instead of regulations

`service_catalog` is the long-term home for campus service discovery content such as
internal service entries, directory pages, topic landing pages, and other navigation-
oriented service artifacts. It is not part of the default phase-1 query-serving scope.
