---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---
# App API Official Web Collector Command Endpoints

<!-- markdownlint-disable MD013 -->

## Document Boundary

This appendix owns collector command endpoint details for the official-web HTTP
contract. The parent contract owns shared authentication, naming, endpoint
summary and non-goals.

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
