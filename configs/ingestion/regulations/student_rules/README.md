# student_rules collection config

This directory holds the repo-tracked config scaffolding for the `student_rules`
collection within the `regulations` corpus.

- `runtime-profile.json`: canonical runtime truth for ingestion/query gating
- `split-manifest.v1.json`: repo-tracked scaffold for handbook logical document
  boundaries
- `canonical-profile.json`: canonical identity and metadata truth for handbook
  documents
- `chunk-profile.json`: chunking/runtime profile record for handbook
  document-level `document-units.jsonl`

Current runtime truth:

- serving stage: `query_serving`
- query enabled: `true`
- serving alias: `student_rules`
- collection prefix: `student_rules`
- release manifests: `regulations/releases/student_rules/{release_id}/...`

Stable handbook-specific policy docs:

- `docs/architecture/student-handbook-ocr-normalization-strategy.md`:
  source-level normalization, split, and document identity truth
- `docs/policies/student-handbook-chunking-and-validation-policy.md`:
  document-level chunk budgeting, short-text aggregation, header policy, and
  validation gate truth

The primary handbook input is source-bucket `provider-response.jsonl`.
`layout-elements.jsonl` is the only source-truth artifact before document
splitting. Each cleaned document then emits `canonical.md` and
`document-units.jsonl` before chunking.

Current OCR ingestion stores document-level artifacts under `regulations/documen
ts/student_rules/{title_slug}-{docid8}/{revision_track}/{year}/...`. Chunk
text/vector payload are not written back to object storage; online chunk truth
lives in Qdrant under release-managed physical collections. The canonical replay
source filename is `学生手册_2018.pdf`.

`student_rules` no longer fans out handbook phone pages, service guides or
service catalogs into campus-services runtime collections. Those guide/contact
facts are wiki-maintained product content, not repo-owned runtime truth. The
handbook split truth keeps regulations-facing logical documents and derived
regulation appendices only.

The repo-tracked `split-manifest.v1.json` is a scaffold and must be filled with
real document ranges before `apps/ingestion-control` admits the
`document_materialize` task for `regulations/student_rules`. The retired Python
raw-ingestion CLI is not an active ingestion entry path; missing TS handlers or
Rust kernels fail closed instead of spawning that old path.
