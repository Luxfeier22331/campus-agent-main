---
doc_type: handoff
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Selected-Write Handoff

This workstream does not promote current read-model truth.

Future selected-write/release work may start only from inventory rows whose operator projection is
`ready_for_selected_write`.

Required release evidence for each row:

- app-api run id
- app-api target job id
- target attempt id
- source object keys
- raw asset id
- raw version id
- staged ingestion status
- staged promotion decision
- null current-truth import before release
- required fields all marked `present`

Current no-promotion previews now provide app-api/target-attempt/source lineage evidence.

Readiness still fails closed until the ingestion consumer reports target field reviews through the
app-api internal execution callback and the operator projection shows every row's `required_fields`
as `present`.

Current target-field review flow:

- `ingestion-worker` derives per-candidate `field_status` from target inventory `required_fields`,
  typed candidate extraction and source refs.
- staged/promoted ingestion callbacks send `targetFieldReviews` to `app-api`.
- `app-api` persists those reviews in `official_web.target_artifact_verification_summaries`.
- target inventory projection reads the latest target summary from PG and combines it with preview
  lineage to classify rows as `blocked_fields` or `ready_for_selected_write`.

Known current blockers:

- contact/service extraction may still leave semantic fields missing, for example
  `responsible_office`, `location`, `office_hours` or `required_materials`.
- `official_web/stable_reference` remains release-gated and is not selected-write-ready merely
  because the page was staged.
- existing preview runs before this callback change need a rerun or explicit review summary write
  before app-api can show non-default field status.
