---
doc_type: contract
status: active
created: 2026-03-29
updated: 2026-03-29
---

# App API Official Web HTTP Contract

## 文档边界

这份文档冻结 `apps/app-api` 暴露给 `official_web` collector 与 operator runtime 的 HTTP contract。

它补充但不替代以下文档：

- `official_web` control-plane 形态：`docs/architecture/official-web-architecture.md`
- source-channel 总边界：`docs/architecture/official-web-architecture.md`
- run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`
- logical schema：`docs/data/app-api-official-web-schema.md`
- browser/product HTTP contract：`docs/contracts/app-api-http.md`

这份文档不冻结：

- object storage 上传协议与签名细节
- collector Docker 的镜像构建与部署 YAML
- panel Worker-local BFF 的具体 route mounting
- ingestion worker 的消费实现细节

## 适用范围

这里的 HTTP surface 分成两组：

- collector command endpoints
  machine-to-machine 调用的 start / heartbeat / finalize seam
- operator query endpoints
  `protected-panel-web` 通过 runtime APIs 消费的 site/run/detail seam

命名规则固定为：

- JSON body 使用 `camelCase`
- 时间戳使用 ISO 8601 UTC 字符串
- enum/code 使用小写语义值，例如 `running`、`completed_with_errors`、`ingestion_failed`

## 认证规则

### Collector Command Endpoints

- 必须使用 machine-to-machine service credentials
- `Authorization: Bearer <service-token-or-equivalent>` 是第一版接受形态
- 可以额外携带 `x-trace-id`

### Operator Query Endpoints

- 继续复用 shared `app-api` 的 operator principal admission
- `protected-panel-web` 仍通过 Worker-local BFF 调用这些 endpoints

## Endpoint Summary

### Collector

- `POST /api/official-web/runs`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`

### Operator

- `GET /api/operator/official-web/sites`
- `GET /api/operator/official-web/sites/:siteId`
- `GET /api/operator/official-web/runs`
- `GET /api/operator/official-web/runs/:runId`

第一版不冻结：

- collector 侧的 cancel / resume API
- operator 写操作 API
- object storage proxy/download API

## Collector Command Endpoints

### `POST /api/official-web/runs`

用途：

- 为一次新的 crawl run 申请 canonical `runId`
- durable 写入 run ledger 的第一条事实

请求体最小形态：

```json
{
  "siteId": "www_muc_edu_cn",
  "schedulerRunKey": "cron-2026-03-29T08:00:00Z",
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
    "siteId": "www_muc_edu_cn",
    "status": "accepted",
    "startedAt": "2026-03-29T08:00:01.000Z",
    "heartbeatIntervalSeconds": 60
  }
}
```

规则：

- `siteId + schedulerRunKey` 是 start admission 的幂等范围
- 同一组幂等键重放且 fingerprint 一致时，返回既有 `runId`
- 幂等键相同但 payload 冲突时，返回 `409 idempotency_conflict`

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
      "objectKey": "official_web/www_muc_edu_cn/runs/owrun_01JQ.../crawl-run.json",
      "contentSha256": "abc123",
      "recordCount": 1
    },
    {
      "artifactType": "url_results",
      "objectKey": "official_web/www_muc_edu_cn/runs/owrun_01JQ.../url-results.jsonl",
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
- `terminalStatus` 第一版允许：
  - `completed`
  - `completed_with_errors`
  - `failed`
- `artifacts` 只登记 object-storage refs，不内嵌 artifact 内容

## Operator Query Endpoints

### `GET /api/operator/official-web/sites`

用途：

- 返回 panel `Official Web / Sites` 视图所需的站点摘要列表

最小响应形态：

```json
{
  "sites": [
    {
      "siteId": "www_muc_edu_cn",
      "displayName": "MUC Official Website",
      "latestRunId": "owrun_01JQ...",
      "latestRunStatus": "completed_with_errors",
      "lastSuccessAt": "2026-03-28T08:16:10.000Z",
      "lastFailureAt": null,
      "latestConfigVersion": "git:abc1234",
      "latestCollectorVersion": "official-web-collector@0.1.0",
      "latestIngestionStatus": "queued"
    }
  ]
}
```

### `GET /api/operator/official-web/sites/:siteId`

用途：

- 返回单站点摘要与最近 run 概览

### `GET /api/operator/official-web/runs`

用途：

- 返回 crawl run 列表

支持的第一版过滤条件：

- `siteId`
- `status`
- `ingestionDispatchStatus`
- `startedAfter`
- `startedBefore`
- `limit`
- `cursor`

### `GET /api/operator/official-web/runs/:runId`

用途：

- 返回单次 run 详情，包含 artifact 摘要与 dispatch 状态

## 非目标

- 不在本文冻结 object storage browser
- 不在本文定义 collector artifact upload API 的签名协议
- 不在本文把 panel 写操作一起引入第一版
