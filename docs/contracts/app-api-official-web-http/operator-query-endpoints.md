---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---
# App API Official Web Operator Query Endpoints

<!-- markdownlint-disable MD013 -->

## Document Boundary

This appendix owns operator query endpoint details for the official-web HTTP
contract. The parent contract owns shared authentication, naming, endpoint
summary and non-goals. Internal ingestion projection ingest details live in
`internal-projection-ingest.md`.

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
- 审批成功后返回 ingestion-control release task 可消费的 deterministic `releaseId`

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
