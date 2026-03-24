## student_handbook collection config

This directory holds the repo-tracked config scaffolding for the `student_handbook`
collection within the `regulations` corpus.

- `runtime-profile.json`: canonical phase-1 runtime truth for ingestion/query gating
- `split-manifest.v1.json`: repo-tracked scaffold for handbook logical document boundaries
- `canonical-profile.json`: canonical identity and metadata truth for handbook documents
- `chunk-profile.json`: chunking/runtime profile record for handbook document-level `document-units.jsonl`

The primary handbook input is processed-layer `provider-response.jsonl`.
`layout-elements.jsonl` is the only asset-level internal truth before document splitting.
Each cleaned document then emits `canonical.md` and `document-units.jsonl` before chunking.
Phase-1 OCR ingestion stores document-level artifacts under `regulations/documents/student_handbook/{title_slug}--{docid8}/{representation}/{year}/...`.
The canonical replay source filename is `学生手册_2018.pdf`; legacy `student-handbook.pdf` remains readable only for migration.

The repo-tracked `split-manifest.v1.json` is a scaffold and must be filled with real
document ranges before `process_raw_ingestion_job` runs with
`INGESTION_CORPUS=regulations` and `INGESTION_COLLECTION=student_handbook`.
