---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
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

## Endpoint Details

Endpoint-family details live in the contract appendices below. Keep shared
wire rules in this parent contract and endpoint-specific payload examples in
the appendix for that endpoint family.

- `app-api-official-web-http/collector-command-endpoints.md`
- `app-api-official-web-http/operator-query-endpoints.md`
- `app-api-official-web-http/internal-projection-ingest.md`

## 非目标

- 不在本文冻结 object storage browser
- 不在本文定义 collector artifact upload API 的签名协议
- 不在本文把 panel 写操作一起引入第一版
