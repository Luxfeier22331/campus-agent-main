## student_rules collection config

This directory holds the repo-tracked config scaffolding for the `student_rules`
collection within the `regulations` corpus.

- `runtime-profile.json`: canonical runtime truth for ingestion/query gating
- `split-manifest.v1.json`: repo-tracked scaffold for handbook logical document boundaries
- `canonical-profile.json`: canonical identity and metadata truth for handbook documents
- `chunk-profile.json`: chunking/runtime profile record for handbook document-level `document-units.jsonl`

Current runtime truth:

- serving stage: `query_serving`
- query enabled: `true`
- serving alias: `student_rules`
- collection prefix: `student_rules`
- release manifests: `regulations/releases/student_rules/{release_id}/...`

Stable handbook-specific policy docs:

- `docs/architecture/student-handbook-ocr-normalization-strategy.md`: source-level normalization, split, and document identity truth
- `docs/policies/student-handbook-chunking-and-validation-policy.md`: document-level chunk budgeting, short-text aggregation, header policy, and validation gate truth

The primary handbook input is source-bucket `provider-response.jsonl`.
`layout-elements.jsonl` is the only source-truth artifact before document splitting.
Each cleaned document then emits `canonical.md` and `document-units.jsonl` before chunking.
Current OCR ingestion stores document-level artifacts under `regulations/documents/student_rules/{title_slug}--{docid8}/{revision_track}/{year}/...`.
Chunk text/vector payload are not written back to object storage; online chunk truth lives in Qdrant under release-managed physical collections.
The canonical replay source filename is `学生手册_2018.pdf`.
One `student_rules` release replay can also fan out release-managed downstream collections declared in `source-projections.v1.json`, including `campus_services/contact_directory` and `campus_services/service_catalog`.
The handbook split truth only keeps regulations-facing logical documents. Non-regulation
service/navigation pages are derived into the offline-only `campus_services` taxonomy
instead of remaining in the `regulations/student_rules` manifest:

- `中央民族大学校内常用电话` -> `campus_services/contact_directory`
- `中央民族大学学生公寓管理工作流程` -> `campus_services/service_catalog`

The repo-tracked `split-manifest.v1.json` is a scaffold and must be filled with real
document ranges before `process_raw_ingestion_job` runs with
`INGESTION_CORPUS=regulations` and `INGESTION_COLLECTION=student_rules`.
