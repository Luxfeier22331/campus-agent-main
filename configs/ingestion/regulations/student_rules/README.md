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

One `student_rules` release replay can also fan out release-managed downstream
collections declared in `source-projections.v1.json`, including
`campus_services/contact_directory` and `campus_services/service_catalog`. The
handbook split truth only keeps regulations-facing logical documents.
Non-regulation service/navigation pages are derived into the offline-only
`campus_services` taxonomy instead of remaining in the
`regulations/student_rules` manifest:

- `中央民族大学校内常用电话` -> `campus_services/contact_directory`
- `中央民族大学学生公寓管理工作流程` -> `campus_services/service_catalog`
- `中央民族大学补办学生证申请表` -> `regulations/student_rules` derived
  form-template document
- `中央民族大学国家助学金申请表` -> `regulations/student_rules` derived
  tabular appendix document
- `勤工助学岗位聘用流程` -> `campus_services/service_catalog` derived
  navigation-leaf document
- `中央民族大学学生公费医疗管理办法` -> curated
  `campus_services/service_guide` records under
  `curated-service-guides/central-minzu-student-public-medical.v1.json`
- `中央民族大学学生申诉管理办法`、`中央民族大学本科(预科)学生证管理办法`、
  `中央民族大学家庭经济困难学生临时困难补助管理办法`、
  `中央民族大学本(预)科学生勤工助学管理办法` 与
  `中央民族大学助学贷款管理暂行办法` -> curated
  `campus_services/service_guide` records under the student affairs and
  financial aid curated guide files

The `campus_services/service_guide` structured current release is built from
`configs/ingestion/campus_services/service_guide/source-truth.v1.json` after a
successful handbook raw ingestion or provider-response replay. The manifest
currently combines the curated student dormitory flow graph, public medical
service guide, student affairs service guide, and financial aid service guide into
  `campus_services/releases/service_guide/current/service-guide-projection.json`.

`source-projections.v1.json` includes a `selector_coverage` release gate:
concrete handbook-derived projections must use bounded source selectors, and
wildcard families must either have a concrete selector or be explicitly marked
deferred. The phone directory selector is locked to
`campus_services/contact_directory`; service guide and service catalog may link
to the resulting contact records but must not consume the phone page directly.

The repo-tracked `split-manifest.v1.json` is a scaffold and must be filled with
real document ranges before `apps/ingestion-control` admits the
`document_materialize` task for `regulations/student_rules`. The retired Python
raw-ingestion CLI is not an active ingestion entry path; missing TS handlers or
Rust kernels fail closed instead of spawning that old path.
