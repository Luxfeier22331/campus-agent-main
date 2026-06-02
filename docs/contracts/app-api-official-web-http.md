---
doc_type: contract
status: active
created: 2026-03-29
updated: 2026-05-02
---
# App API Official Web HTTP Contract

## 文档边界

这份文档冻结 `apps/app-api` 暴露给 `official_web` collector 与 operator runtime 的 HTTP
contract。

它补充但不替代以下文档：

- `official_web` control-plane
  形态：`docs/architecture/domains/official-web/architecture.md`
- source-channel 总边界：`docs/architecture/domains/official-web/architecture.md`
- 领域导航：`docs/domains/official-web.md`
- run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`
- logical schema：`docs/data/app-api-official-web-schema.md`
- browser/product HTTP contract：`docs/contracts/app-api-http.md`

这份文档不冻结：

- object storage 上传协议与签名细节
- collector Docker 的镜像构建与部署 YAML
- panel Worker-local BFF 的具体 route mounting
- ingestion worker 的消费实现细节
- `fresh_news` / `news_archive` 的当前开放状态或单轮执行进度

## Contract 与实现范围说明

这份文档冻结的是 forward HTTP seam，不表示 `develop` 已完整实现文中所有 endpoint。

判断当前已实现子集时：

- 当前已落地能力以
  `docs/architecture/current-architecture.md`、`docs/domains/official-web.md`
  和代码为准
- 当前 accepted direction 与长期边界以本文、supporting architecture、schema 与相关 ADR 为准

## 适用范围

这里的 HTTP surface 分成两组：

- collector command endpoints machine-to-machine 调用的 start / heartbeat /
  finalize seam
- ingestion projection ingest endpoints 由 `apps/ingestion-worker` machine-to-machine
  上报 operator-safe read model
- operator query endpoints `protected-panel-web` 通过 runtime APIs 消费的
  site/run/detail seam

命名规则固定为：

- JSON body 使用 `camelCase`
- 时间戳使用 ISO 8601 UTC 字符串
- enum/code 使用小写语义值，例如 `running`、`completed_with_errors`、`ingestion_failed`

## 认证规则

### Collector Command Endpoints

- 必须使用 machine-to-machine service credentials
- `Authorization: Bearer <service-token-or-equivalent>` 是第一版接受形态
- 可以额外携带 `x-trace-id`
- 如果 command endpoint 通过 `api-staging.mucwiki-edge.link` 或等价 hostname 进入
  `app-api`，该 hostname 必须按 machine ingress 保护；Cloudflare Access service token /
  Tunnel / private network policy 不能替代本节 bearer token

### Operator Query Endpoints

- 继续复用 shared `app-api` 的 operator principal admission
- `protected-panel-web` 仍通过 Worker-local BFF 调用这些 endpoints

## Endpoint Summary

### Collector

- `POST /api/official-web/runs`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/plans:resolve`
- `POST /api/official-web/runs/:runId/finalize`

### Internal Projection Ingest

- `POST /api/internal/operator/official-web/release-task-snapshots`

### Operator

- `GET /api/operator/official-web/sites`
- `GET /api/operator/official-web/sites/:siteId`
- `GET /api/operator/official-web/runs`
- `GET /api/operator/official-web/runs/:runId`
- `GET /api/operator/official-web/target-inventory`
- `GET /api/operator/official-web/target-inventory/:inventoryId`
- `POST /api/operator/official-web/target-inventory/:inventoryId/release-gates`
- `GET /api/operator/official-web/target-release-gates/:releaseId`
- `GET /api/operator/official-web/release-tasks`
- `GET /api/operator/official-web/release-tasks/:id`

### Removed Ingestion Executor Surfaces

These routes are intentionally outside app-api and must return `404`:

- `GET /api/internal/official-web/target-release-gates/:releaseId`
- `POST /api/internal/official-web/target-release-gates/:releaseId/execution-status`
- `POST /api/internal/official-web/target-inventory/:inventoryId/selected-write-admissions:evaluate`
- `GET /api/operator/official-web/target-selected-write-admissions/:selectedWriteId`
- `POST /api/operator/official-web/target-selected-write-admissions/:selectedWriteId/interventions`
- `GET /api/internal/official-web/target-selected-write-tasks/:selectedWriteId`
- `POST /api/internal/official-web/target-selected-write-tasks/:selectedWriteId/execution-status`

Release task claim / retry / executor progress / publish status belongs to
`packages/ingestion-core` plus `apps/ingestion-worker`. App-api only exposes already-ingested
official-web projections and the operator command ledger needed to record stable-reference
approve/reject decisions.

第一版不冻结：

- collector 侧的 cancel / resume API
- operator 写操作 API；stable-reference release gate 仍是显式受控例外，contact/service
  selected-write happy path 由 ingestion-owned release task state machine 承担
- object storage proxy/download API

## Collector Command Endpoint Details

### `POST /api/official-web/runs`

用途：

- 为一次新的 crawl run 申请 canonical `runId`
- durable 写入 run ledger 的第一条事实

请求体最小形态：

```json
{
  "siteId": "muc_public",
  "schedulerRunKey": "cron-2026-03-29T08:00:00Z",
  "runIntent": "baseline",
  "triggerType": "scheduled",
  "collectorVersion": "official-web-collector@0.1.0",
  "configVersion": "git:abc1234",
  "crawlPolicyVersion": "2026-03-29",
  "hostSet": ["www.muc.edu.cn"],
  "seedSet": ["https://www.muc.edu.cn/"],
  "startedAt": "2026-03-29T08:00:01.000Z"
}
```

成功响应：

```json
{
  "run": {
    "runId": "owrun_01JQ...",
    "siteId": "muc_public",
    "status": "accepted",
    "startedAt": "2026-03-29T08:00:01.000Z",
    "heartbeatIntervalSeconds": 60
  }
}
```

规则：

- `siteId + schedulerRunKey + runIntent` 是 start admission 的幂等范围
- 同一组幂等键重放且 fingerprint 一致时，返回既有 `runId`
- 幂等键相同但 payload 冲突时，返回 `409 idempotency_conflict`

### `POST /api/official-web/plans:resolve`

用途：

- 基于 `official_web.page_freshness` 为本次 run 解析 lane-aware 的动态 workset
- 让 collector 在静态 host scope 内优先抓取当前到期、需要复抓的页面

请求体最小形态：

```json
{
  "siteId": "muc_public",
  "runIntent": "hot",
  "hostFilter": ["www.muc.edu.cn"],
  "maxPagesPerHost": 10,
  "maxTotalPages": 40,
  "now": "2026-03-30T09:00:00.000Z"
}
```

成功响应：

```json
{
  "plan": {
    "siteId": "muc_public",
    "runIntent": "hot",
    "resolvedAt": "2026-03-30T09:00:00.000Z",
    "hostFilter": ["www.muc.edu.cn"],
    "maxPagesPerHost": 10,
    "maxTotalPages": 40,
    "summary": {
      "duePages": 1,
      "listingPages": 1,
      "repairPages": 0,
      "selectedHosts": 1,
      "staticPages": 0
    },
    "duePages": [
      {
        "siteId": "muc_public",
        "host": "www.muc.edu.cn",
        "normalizedCanonicalUrl": "https://www.muc.edu.cn/news/",
        "pageFamily": "listing_page",
        "pageTitleNormalized": "News",
        "cadenceClass": "listing_hot",
        "priorityScore": 80,
        "nextEligibleFetchAt": "2026-03-30T08:55:00.000Z",
        "lastFetchDisposition": "fetched",
        "etag": "\"etag-123\"",
        "lastModified": "Sat, 29 Mar 2026 23:10:00 GMT",
        "mainContentHash": "main-sha"
      }
    ]
  }
}
```

规则：

- collector 应在 start admission 成功后、实际 materialize frontier 之前调用该接口
- `baseline` 主要返回 `baseline_static` 且已到期的页面
- `hot` 主要返回 `listing_hot` 与 `detail_recent` 且已到期的页面
- `repair` 主要返回 `lastFetchDisposition=fetch_failed` 的页面
- `deleted` 页面不会重新进入 planner workset，除非后续被重新发现并写回 freshness truth
- `hostFilter`、`maxPagesPerHost`、`maxTotalPages` 是本次 run 的预算提示，不会改变
  `page_freshness` 作为 durable truth 的 ownership

### `POST /api/official-web/runs/:runId/heartbeats`

用途：

- 更新 run 活性与过程摘要

请求体最小形态：

```json
{
  "sequence": 3,
  "observedAt": "2026-03-29T08:05:00.000Z",
  "counts": {
    "urlsDiscovered": 280,
    "urlsFetched": 220,
    "pagesNormalized": 180,
    "artifactUploads": 6,
    "failures": 4
  }
}
```

成功响应：

```json
{
  "run": {
    "runId": "owrun_01JQ...",
    "status": "running",
    "lastHeartbeatAt": "2026-03-29T08:05:00.000Z"
  }
}
```

规则：

- `sequence` 必须对同一 `runId` 单调递增
- heartbeats 只更新 process summary，不替代 terminal finalize

### `POST /api/official-web/runs/:runId/finalize`

用途：

- 提交 terminal summary、artifact refs 与 ingestion handoff intent

请求体最小形态：

```json
{
  "terminalStatus": "completed_with_errors",
  "finishedAt": "2026-03-29T08:17:32.000Z",
  "pageObservations": [
    {
      "observedAt": "2026-03-29T08:17:32.000Z",
      "requestedUrl": "https://www.muc.edu.cn/admissions",
      "finalUrl": "https://www.muc.edu.cn/admissions",
      "normalizedCanonicalUrl": "https://www.muc.edu.cn/admissions",
      "pageFamily": "article_detail",
      "pageTitleNormalized": "Admissions",
      "discoveryMethod": "seed",
      "host": "www.muc.edu.cn",
      "httpStatus": 200,
      "contentType": "text/html",
      "responseBodyHash": "body-sha",
      "mainContentHash": "main-sha",
      "disposition": "fetched"
    }
  ],
  "summary": {
    "urlsDiscovered": 420,
    "urlsFetched": 390,
    "pagesNormalized": 310,
    "rawAssetsObserved": 310,
    "failureCount": 12
  },
  "artifacts": [
    {
      "artifactType": "crawl_run_manifest",
      "objectKey": "official_web/muc_public/runs/owrun_01JQ.../crawl-run.json",
      "contentSha256": "abc123",
      "recordCount": 1
    },
    {
      "artifactType": "url_results",
      "objectKey": "official_web/muc_public/runs/owrun_01JQ.../url-results.jsonl",
      "contentSha256": "def456",
      "recordCount": 390
    }
  ]
}
```

成功响应：

```json
{
  "run": {
    "runId": "owrun_01JQ...",
    "status": "completed_with_errors",
    "ingestionDispatchStatus": "queued",
    "finishedAt": "2026-03-29T08:17:32.000Z"
  }
}
```

规则：

- finalize 是 terminal action；同一 `runId` 成功 finalize 后不得再次提交不同 terminal payload
- `pageObservations` 是 collector 向 `app-api` 上报 page-level durable truth 的
  seam；不再只靠 artifact ref 间接表达
- `terminalStatus` 第一版允许：
  - `completed`
  - `completed_with_errors`
  - `failed`
- `artifacts` 只登记 object-storage refs，不内嵌 artifact 内容
- `app-api` 会基于 `pageObservations` 计算 `new / changed / deleted / not_modified /
  fetch_failed`
- ingestion handoff payload 只推进 `new / changed / deleted` 变化集合；`not_modified` 与
  `fetch_failed` 只更新 freshness truth、operator summary 与后续 repair cadence

## Operator Query Endpoint Details

### `GET /api/operator/official-web/sites`

用途：

- 返回 panel `Official Web / Sites` 视图所需的站点摘要列表

最小响应形态：

```json
{
  "sites": [
    {
      "siteId": "muc_public",
      "displayName": "Minzu University of China public web",
      "latestRunId": "owrun_01JQ...",
      "latestRunStatus": "completed_with_errors",
      "lastSuccessAt": "2026-03-28T08:16:10.000Z",
      "lastFailureAt": null,
      "latestConfigVersion": "git:abc1234",
      "latestCollectorVersion": "official-web-collector@0.1.0",
      "latestIngestionDispatchStatus": "queued"
    }
  ]
}
```

### `GET /api/operator/official-web/sites/:siteId`

用途：

- 返回单站点摘要、freshness summary、最近 run 与最近 page change

最小响应形态：

```json
{
  "site": {
    "siteId": "muc_public",
    "displayName": "Minzu University of China public web",
    "hostRoots": ["www.muc.edu.cn"],
    "latestRunId": "owrun_01JQ...",
    "latestRunStatus": "completed_with_errors",
    "lastSuccessAt": "2026-03-30T08:20:00.000Z",
    "lastFailureAt": null,
    "latestConfigVersion": "git:abc1234",
    "latestCollectorVersion": "official-web-collector@0.1.0",
    "latestIngestionDispatchStatus": "queued",
    "projectedAt": "2026-03-30T08:20:03.000Z"
  },
  "freshnessBacklog": {
    "duePages": [
      {
        "siteId": "muc_public",
        "host": "www.muc.edu.cn",
        "normalizedCanonicalUrl": "https://www.muc.edu.cn/news/",
        "pageFamily": "listing_page",
        "pageTitleNormalized": "News",
        "cadenceClass": "listing_hot",
        "priorityScore": 90,
        "lastFetchDisposition": "fetched",
        "lastChangeReason": "main_content_changed",
        "lastHttpStatus": 200,
        "lastSeenAt": "2026-03-30T08:00:00.000Z",
        "lastChangedAt": "2026-03-30T08:00:00.000Z",
        "nextEligibleFetchAt": "2026-03-30T08:30:00.000Z"
      }
    ],
    "hotPages": [],
    "failedFetchPages": [],
    "deletedPages": []
  },
  "freshnessSummary": {
    "totalPages": 1200,
    "duePages": 38,
    "hotPages": 24,
    "repairPages": 3,
    "failedFetchPages": 3,
    "changedLast24h": 17,
    "deletedPages": 5
  },
  "recentRuns": [],
  "recentPageChanges": []
}
```

### `POST /api/operator/official-web/target-inventory/:inventoryId/release-gates`

用途：

- 对 `official_web/stable_reference` previewed target inventory row 记录 approve/reject
  release gate
- 审批成功后返回 ingestion-worker 可消费的 deterministic `releaseId`

请求体最小形态：

```json
{
  "decision": "approved",
  "publishAlias": false,
  "notes": "reviewed against staged preview evidence"
}
```

规则：

- 仅 operator principal 可调用
- `approved` 要求 preview lineage 完整、ingestion status 为 `staged`、当前 truth import 为空、所有
  required fields 均为 `present`
- `publishAlias` 默认 `false`

### App-api / Ingestion Boundary For Release Tasks

规则：

- app-api 不提供 release executor read/callback routes
- app-api 不提供 contact/service selected-write admission、task read 或 intervention
  routes
- `POST /api/internal/operator/official-web/release-task-snapshots` 只接收 ingestion
  worker 产出的 redacted operator-safe projection snapshot；它不是 release task executor
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

- 由 `apps/ingestion-worker` 上报 release task 的 operator-safe projection snapshot
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
      "producerVersion": "campus_ingestion_core.official_web_release_task_projection.v1",
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

### `GET /api/operator/official-web/release-tasks`

用途：

- 返回 release task 的 operator projection 列表，用于 panel 观察 selected-write /
  stable-reference release 进度

支持的第一版过滤条件：

- `taskType`
- `status`
- `selectedWriteTarget`
- `inventoryId`
- `jobId`
- `runId`
- `q`
- `updatedAfter`
- `updatedBefore`
- `limit`
- `cursor`

响应中的每条 task 至少包含：

- `taskId`
- `taskType`
- `sourceChannel`
- `inventoryId`
- `jobId`
- `runId`
- `selectedWriteTarget`
- `lifecycleStatus`
- `latestStage`
- `attemptCount`
- `maxAttempts`
- `inputSummary`
- `outputSummary`
- 对 selected-write task，`outputSummary` 至少允许包含：
  - `releaseId`
  - `corpus`
  - `collection`
  - `recordCount`
  - `fullRecordCount`
  - `taskScopeDisplayNames`
  - `fullImpactDisplayNames`
- `timeline`
- `freshnessStatus`

### `GET /api/operator/official-web/release-tasks/:id`

用途：

- 返回单个 release task 的 operator projection 详情
- 详情只展示 redacted summary、timeline、error summary 与 freshness summary

规则：

- 仅 operator principal 可调用
- `:id` 使用 `taskId`
- 返回 `404 official_web_release_task_not_found` 表示 app-api 尚未收到该 task 的投影

### `GET /api/operator/official-web/runs`

用途：

- 返回 crawl run 列表

支持的第一版过滤条件：

- `siteId`
- `runIntent`
- `status`
- `ingestionDispatchStatus`
- `startedAfter`
- `startedBefore`
- `limit`
- `cursor`

响应中的每条 run 至少包含：

- `runIntent`
- `status`
- `ingestionDispatchStatus`
- `failureCount`
- `summary`
- `artifacts`

### `GET /api/operator/official-web/runs/:runId`

用途：

- 返回单次 run 详情，包含 artifact 摘要与 dispatch 状态

最小响应形态：

```json
{
  "run": {
    "runId": "owrun_01JQ...",
    "siteId": "muc_public",
    "runIntent": "repair",
    "status": "completed_with_errors",
    "ingestionDispatchStatus": "queued",
    "failureCount": 2,
    "summary": {
      "urlsFetched": 12,
      "failureCount": 2
    },
    "artifacts": []
  },
  "pageChangeSummary": {
    "newPages": 0,
    "changedPages": 1,
    "deletedPages": 0,
    "notModifiedPages": 8,
    "failedFetchPages": 2
  },
  "pageChanges": [
    {
      "id": "owobs_01JQ...",
      "runId": "owrun_01JQ...",
      "changeStatus": "fetch_failed",
      "fetchDisposition": "fetch_failed",
      "host": "www.muc.edu.cn",
      "normalizedCanonicalUrl": "https://www.muc.edu.cn/news/20260330/notice.htm",
      "pageFamily": "article_detail",
      "pageTitleNormalized": "Notice",
      "httpStatus": 502,
      "lastChangeReason": "fetch_failed",
      "observedAt": "2026-03-30T09:02:00.000Z",
      "rawAssetId": null,
      "rawVersionId": null
    }
  ]
}
```

规则：

- run detail 直接返回 `run + pageChangeSummary + pageChanges`，不再要求 panel 额外拼接多个读取面
- operator query 中的 `pageChanges` 会展示 `new / changed / deleted / fetch_failed`
- `not_modified` 不进入 run/site detail 的 recent change 列表，但会保留在 summary 与
  freshness truth 中

## 非目标

- 不在本文冻结 object storage browser
- 不在本文定义 collector artifact upload API 的签名协议
- 不在本文把 panel 写操作一起引入第一版
