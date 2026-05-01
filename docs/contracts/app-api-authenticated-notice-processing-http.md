---
doc_type: contract
status: active
created: 2026-05-01
updated: 2026-05-01
---
# App API Authenticated Notice Processing HTTP Contract

## 文档边界

本文冻结 authenticated notice processing 的 app-api owned operator-safe HTTP seam。

它回答：

- ingestion worker 如何把安全 processing snapshot 写入 app-api
- protected panel 如何查询通知处理状态
- 哪些字段不得通过 operator API 暴露

它不冻结：

- collector 抓取协议
- ingestion queue 表结构
- 对象存储 bucket/key 语义
- raw OCR、正文、附件或 operations 目录读取方式
- retry/cancel/re-enqueue 操作 API

## Ownership

canonical panel read path 固定为：

`apps/protected-panel-web -> apps/app-api -> operator.authenticated_notice_processing_projection`

ingestion evidence truth 仍在 queue/source-handoff/object-store/downstream release
体系内。app-api 只持有 operator-safe projection，panel 不直接读取 queue、object-store、
operations 目录或 raw logs。

## Authentication

### Internal Snapshot Ingest

`POST /api/internal/operator/authenticated-notices/processing-snapshots`

- caller class: `machine-internal`
- admission: `x-app-internal-auth` 必须匹配 `APP_API_INTERNAL_SHARED_SECRET`
- content type: `application/json`

### Operator Query

- `GET /api/operator/authenticated-notices/processing`
- `GET /api/operator/authenticated-notices/processing/:noticeId`

这些 endpoint 只接受已解析的 operator principal。protected panel 通过同站
`/api/authenticated-notices/processing*` 代理访问，不直接暴露 app-api internal route。

## Snapshot Ingest Payload

请求体：

```json
{
  "snapshots": [
    {
      "id": "authenticated_notice_portal:notice:muc_internal_portal:355867:run-001:job-001",
      "noticeKey": "authenticated_notice_portal:notice:muc_internal_portal:355867",
      "sourceChannel": "authenticated_notice_portal",
      "sourceSurface": "notice",
      "siteId": "muc_internal_portal",
      "noticeId": "355867",
      "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
      "runId": "run-001",
      "jobId": "job-001",
      "replayBatchId": "manual-smoke-20260501",
      "enqueueSource": "manual_replay",
      "queueStatus": "succeeded",
      "lifecycleStatus": "tool_ready",
      "latestStage": "tool_ready",
      "targetSurface": "campus_services",
      "candidateKind": "transport_schedule",
      "materializationStatus": "completed",
      "releaseId": "transport-schedule-run-001-job-001",
      "current": true,
      "toolReady": true,
      "readModelCounts": {
        "currentSnapshots": 1,
        "rejectedSources": 0,
        "scheduledDepartures": 49,
        "snapshots": 1
      },
      "childTaskSummary": {
        "byKind": {
          "downstream_materialization": 1
        },
        "byState": {
          "completed": 3
        },
        "highestSeverity": "none",
        "taskCount": 3
      },
      "timeline": [
        {
          "stage": "downstream_materialization",
          "status": "completed",
          "occurredAt": "2026-05-01T08:00:00.000Z",
          "summary": "downstream materialization completed",
          "payload": {
            "reasonCode": "downstream_materialization_completed"
          }
        }
      ],
      "downstream": {
        "targetSurface": "campus_services",
        "candidateKind": "transport_schedule",
        "releaseId": "transport-schedule-run-001-job-001",
        "current": true,
        "toolReady": true,
        "readModelCounts": {
          "scheduledDepartures": 49,
          "rejectedSources": 0
        }
      },
      "lastErrorCode": null,
      "lastErrorMessage": null,
      "attemptCount": 1,
      "lastObservedAt": "2026-05-01T08:00:01.000Z",
      "sourceUpdatedAt": "2026-05-01T08:00:00.000Z",
      "projectedAt": "2026-05-01T08:00:01.000Z",
      "producerVersion": "campus_ingestion_core.authenticated_notice_processing_projection.v1",
      "redactionVersion": "authenticated_notice_processing_redaction.v1"
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

- `id` 是 processing snapshot 幂等键
- timeline event 使用 `eventId` 时按 event id 幂等 upsert；缺省时由 snapshot id、stage、
  status、occurredAt 与 ordinal 派生
- snapshot ingest 是 upsert，不改变 queue/source truth
- timeline payload 可携带 operator-safe audit/cleanup evidence，例如
  `auditRunId`、`cleanupRunId`、`cleanupDisposition`、`postgresExactRemaining`、
  `objectStoreExactKeysRemaining` 与 `qdrantResidueCount`
- timeline payload 不得携带 bucket、object key、backup path、artifact path、raw
  operations path、OCR text、notice body、HTML、attachment bytes 或 provider payload
- first release 只读，不支持 retry/cancel/re-enqueue

## Operator List

`GET /api/operator/authenticated-notices/processing`

query filters：

- `noticeId`
- `q`
- `status`
- `targetSurface`
- `candidateKind`
- `queueStatus`
- `runId`
- `replayBatchId`
- `updatedAfter`
- `updatedBefore`
- response field `freshnessStatus` is app-api computed but is not a first-release
  list filter
- `limit`
- `cursor`

成功响应：

```json
{
  "notices": [],
  "page": {
    "nextCursor": null
  }
}
```

## Operator Detail

`GET /api/operator/authenticated-notices/processing/:noticeId`

成功响应：

```json
{
  "notice": {
    "noticeId": "355867",
    "lifecycleStatus": "tool_ready",
    "candidateKind": "transport_schedule",
    "toolReady": true,
    "freshnessStatus": "fresh",
    "staleReasonCode": null,
    "readModelCounts": {
      "scheduledDepartures": 49,
      "rejectedSources": 0
    }
  }
}
```

如果同一 `noticeId` 有多个 attempt，detail 返回 effective record。排序优先级为：

1. `toolReady=true`
2. `current=true`
3. `projectedAt desc`

## Freshness

Freshness is computed by app-api at query time. Protected panel must display the
returned fields and must not infer staleness from local browser time.

- terminal records (`tool_ready`, `materialized`, `manual_review`,
  `failed_terminal`, `dead_letter`, `cancelled`, or queue `succeeded`) are
  returned as `fresh`
- active records older than the configured stale window are returned as `stale`
  with `staleReasonCode=active_processing_observation_overdue`
- records without a valid `lastObservedAt` are returned as `unknown`

## Redaction Rules

snapshot ingest 与 query response 禁止出现以下 raw/internal 字段族：

- raw notice body、HTML、Markdown 正文全文
- OCR text、OCR tables、OCR payload
- attachment bytes 或 raw attachment records
- cookies、credentials、authorization material
- local paths、operations directory paths、source file paths
- object-store bucket/key、presigned/internal URL
- raw stack traces

允许展示：

- stable notice/run/job/release ids
- status codes 与 normalized error code/message
- summary-level child task counts
- schedule read-model counts
- sanitized timeline summaries
