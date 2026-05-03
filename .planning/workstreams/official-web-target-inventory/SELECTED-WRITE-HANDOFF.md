---
doc_type: handoff
status: completed
created: 2026-05-01
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Selected-Write Handoff

This inventory workstream does not promote current read-model truth by itself.

Selected-write/release work may start only from inventory rows whose operator projection is
`ready_for_selected_write`. Machine admission, claim, retry, dead-letter and publish state belong
to the ingestion release task state machine, not app-api.

2026-05-03 closeout:

- the first admitted `campus_services/contact_directory` and `campus_services/service_guide`
  service-info rows have now moved past preview and into real published current state
- five queued selected-write tasks were promoted through the canonical ingestion runner with app-api
  callback enabled
- operator list/detail read models under `/api/operator/official-web/release-tasks*` now expose the
  published tasks
- further selected-write work for new target rows should start from a new active workstream rather
  than reopening this inventory handoff

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

- `ingestion-worker` derives `field_status` from target inventory `required_fields`.
- selected-write candidates use typed candidate extraction and source refs.
- release-gated stable-reference documents use projected document lineage, document content presence
  and source refs.
- staged/promoted ingestion callbacks send `targetFieldReviews` to `app-api`.
- `app-api` persists those reviews in `official_web.target_artifact_verification_summaries`.
- target inventory projection reads the latest target summary from PG and combines it with preview
  lineage to classify rows as `blocked_fields` or `ready_for_selected_write`.
- `release_gate_required` targets with complete preview lineage and complete fields stay `previewed`
  with `release_gate_not_reviewed`; they do not become `ready_for_selected_write`.

Implemented release split:

- `official_web/stable_reference` keeps an explicit app-api release gate as an operator
  approve/reject command ledger. The ingestion release task state machine consumes a task payload
  with the gate evidence, imports only the matching target document with `scope_refresh = None`,
  and then runs registry release with `publishAlias = false` by default.
- `campus_services/contact_directory` and `campus_services/service_guide` use ingestion-owned
  selected-write release tasks. The task replays the source-truth bundle, filters the matching typed
  candidate by `jobId`, `selectedWriteTarget` and `sourceUrls`, and writes only the target
  structured projection current read model.
- existing preview runs before this callback change need a rerun or explicit review summary write
  before app-api can show non-default field status.

Stable-reference release flow:

- operator route: `POST /api/operator/official-web/target-inventory/:inventoryId/release-gates`
- operator read: `GET /api/operator/official-web/target-release-gates/:releaseId`
- ingestion worker CLI:
  `campus-ingestion-release-official-web-target --release-task-path <release-task.json>`
- default ingestion task status progression: `queued -> claimed -> running -> materialized ->
  indexed`; if `publishAlias` is explicitly approved, final status becomes `published`.

Contact/service selected-write flow:

- worker CLI:
  `campus-ingestion-release-official-web-selected-write --release-task-path <release-task.json>`
- default ingestion task status progression: `queued -> claimed -> running -> materialized ->
  published`
