## curriculum_plan ingestion config

This directory holds the repo-tracked config scaffolding for the `curriculum_plan` raw-first ingestion path.

- `runtime-profile.json`: canonical phase-1 runtime truth for ingestion/query gating
- `split-manifest.v1.json`: static page-range truth for splitting one master PDF into logical documents
- `chunk-profile.json`: chunking/runtime profile record for this corpus
- `retrieval-profile.json`: retrieval/runtime profile record for this corpus

The split manifest must be filled with the real document list and page ranges before `process_raw_ingestion_job` is run with `INGESTION_CORPUS=curriculum_plan`.
