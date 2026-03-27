## student_handbook collection config

This directory holds the repo-tracked config scaffolding for the `student_handbook`
collection within the `regulations` corpus.

- `runtime-profile.json`: canonical phase-1 runtime truth for ingestion/query gating
- `split-manifest.v1.json`: repo-tracked scaffold for handbook logical document boundaries
- `canonical-profile.json`: canonical identity and metadata truth for handbook documents
- `chunk-profile.json`: chunking/runtime profile record for handbook document-level `document-units.jsonl`

Stable handbook-specific policy docs:

- `docs/architecture/student-handbook-ocr-normalization-strategy.md`: source-level normalization, split, and document identity truth
- `docs/architecture/student-handbook-chunking-and-validation-policy.md`: document-level chunk budgeting, short-text aggregation, header policy, and validation gate truth

The primary handbook input is source-bucket `provider-response.jsonl`.
`layout-elements.jsonl` is the only source-truth artifact before document splitting.
Each cleaned document then emits `canonical.md` and `document-units.jsonl` before chunking.
Phase-1 OCR ingestion stores document-level artifacts under `regulations/documents/student_handbook/{title_slug}--{docid8}/{revision_track}/{year}/...`.
The canonical replay source filename is `学生手册_2018.pdf`.
The handbook split truth only keeps regulations-facing logical documents. Non-regulation
service/navigation pages are derived into the offline-only `campus_services` taxonomy
instead of remaining in the `regulations/student_handbook` manifest:

- `中央民族大学校内常用电话` -> `campus_services/contact_directory`
- `中央民族大学学生公寓管理工作流程` -> `campus_services/service_catalog`

The repo-tracked `split-manifest.v1.json` is a scaffold and must be filled with real
document ranges before `process_raw_ingestion_job` runs with
`INGESTION_CORPUS=regulations` and `INGESTION_COLLECTION=student_handbook`.
