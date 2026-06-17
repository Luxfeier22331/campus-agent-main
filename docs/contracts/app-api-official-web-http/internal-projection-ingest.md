---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---
# App API Official Web Internal Projection Ingest

<!-- markdownlint-disable MD013 -->

## Document Boundary

This appendix owns the internal ingestion-to-app-api projection ingest seam for
official-web release task snapshots. It does not define ingestion release task
execution ownership.

### App-api / Ingestion Boundary For Release Tasks

规则：

- app-api 不提供 release executor read/callback routes
- app-api 不提供 contact/service selected-write admission、task read 或 intervention
  routes
- `POST /api/internal/operator/official-web/release-task-snapshots` 只接收
  ingestion-control 产出的 redacted operator-safe projection snapshot；它不是 release task executor
  callback，也不改变 task truth
- stable-reference `release-gates` 只记录 operator approve/reject command ledger；
  executor claim、lease、running/materialized/indexed/published/failed 状态由
  ingestion release task state machine 记录
- contact/service selected-write 的准入、claim、retry、dead-letter 与 publish 状态同样由
  ingestion release task state machine 记录
- Panel 如需展示 selected-write 进度，只能读取 ingestion 投影后的 operator read model，而不是
  通过 app-api mutation 直接干预 release task

### `POST /api/internal/operator/official-web/release-task-snapshots`

用途：

- 由 `apps/ingestion-control` 上报 release task 的 operator-safe projection snapshot
- 在 `app-api` 中 upsert `operator.official_web_release_task_projection` 与
  `operator.official_web_release_task_event_projection`

请求体最小形态：

```json
{
  "snapshots": [
    {
      "id": "owrt_01JQ...",
      "schemaVersion": "official_web_release_task_projection.v1",
      "taskId": "owrt_01JQ...",
      "taskType": "selected_write",
      "sourceChannel": "official_web",
      "inventoryId": "owinv_01JQ...",
      "jobId": "owjob_01JQ...",
      "runId": "owrun_01JQ...",
      "selectedWriteTarget": "contact_directory",
      "lifecycleStatus": "indexed",
      "latestStage": "indexed",
      "attemptCount": 1,
      "maxAttempts": 3,
      "inputSummary": {
        "sourceObjectCount": 2,
        "sourceUrlCount": 1
      },
      "outputSummary": {
        "releaseId": "owrelease_selected_write_01JQ...",
        "corpus": "campus_services",
        "collection": "contact_directory",
        "recordCount": 1,
        "fullRecordCount": 2,
        "taskScopeDisplayNames": ["中央民族大学信息公开联系方式"],
        "fullImpactDisplayNames": ["中央民族大学", "中央民族大学信息公开联系方式"]
      },
      "timeline": [
        {
          "stage": "indexed",
          "status": "indexed",
          "occurredAt": "2026-05-02T08:00:00.000Z",
          "summary": "official web release task observed: indexed"
        }
      ],
      "lastErrorCode": null,
      "lastErrorMessage": null,
      "createdAt": "2026-05-02T07:59:00.000Z",
      "updatedAt": "2026-05-02T08:00:00.000Z",
      "projectedAt": "2026-05-02T08:00:01.000Z",
      "producerVersion": "official_web_release_task_projection.v1",
      "redactionVersion": "official_web_release_task_redaction.v1"
    }
  ]
}
```

成功响应：

```json
{
  "accepted": 1
}
```

规则：

- 必须通过 internal shared secret admission
- payload 不得包含 object bucket/key、raw HTML、raw body、credential、stack trace 或本地路径
- `taskId` 是 snapshot 幂等 upsert key；timeline event 使用 `eventId` 或
  deterministic event identity 幂等写入
- app-api 只保存 redacted summary 与 timeline，不保存 release task input/output truth
- selected-write `outputSummary` 采用双轨摘要语义：
  - `recordCount` / `taskScopeDisplayNames` 表示本次 task-scope 写入集合
  - `fullRecordCount` / `fullImpactDisplayNames` 表示与当前 projection merge 后的
    全量 current 影响面
  - panel 只展示 ingestion worker 已投影的摘要，不在 app-api 或 panel 侧自行推导“本次写入”和“全量影响”
