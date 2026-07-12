---
doc_type: contract
truth_scope: repository
owner_boundary: apps/ops-web
status: active
created: 2026-07-08
updated: 2026-07-11
---

# Ops Web 接口

## 范围

本文定义 `apps/ops-web` 服务端提供给自身页面的 HTTP 接口。可执行合同位于
`apps/ops-web/src/server/app.ts` 和 `apps/ops-web/src/shared/ops-contract.ts`。

接口只有：

- `GET /api/ops/overview`
- `GET /api/ops/requests`
- `GET /api/ops/requests/:requestId`
- `GET /api/ops/requests/:requestId/observability`
- `GET /healthz`
- `GET /readyz`

不存在 `/api/ops/runtime`、`/api/ops/evidence/*` 或通用查询代理。

## 通用规则

### 身份和权限

- `/api/ops/*` 验证 Cloudflare Access JWT 的签发方、受众和签名。
- JWT 对应的人员邮箱或服务令牌 ID 必须进入基础操作者白名单。
- 原始日志和调用链读取还必须进入独立的原始观测数据白名单。
- 浏览器不持有 PostgreSQL、OpenObserve 或外部平台凭据。

### 响应和错误

- 成功正文为 UTF-8 JSON，并在返回前通过 Zod 校验。
- `/api/ops/overview` 返回
  `Cache-Control: private, max-age=15, stale-if-error=300`。
- 其他 `/api/ops/*` 返回 `Cache-Control: no-store`。
- 查询失败不能转换为空数组、`NO_DATA` 或成功状态。
- 错误正文不得包含数据库地址、JWT、Cookie、Secret 或外部平台凭据。
- 所有页面和接口设置内容安全策略并禁止被其他站点嵌入。

错误格式：

```json
{
  "error": {
    "code": "OPS_INVALID_QUERY",
    "message": "请求列表查询参数无效。"
  }
}
```

主要错误码：

| HTTP | 错误码 | 含义 |
| ---: | --- | --- |
| 400 | `OPS_INVALID_QUERY` | 查询参数或游标无效 |
| 400 | `OPS_INVALID_REQUEST_ID` | 请求 ID 格式无效 |
| 401 | `OPS_ACCESS_JWT_MISSING`、`OPS_ACCESS_JWT_INVALID` | 未通过 Access 验证 |
| 403 | `OPS_RAW_OBSERVABILITY_FORBIDDEN` | 无原始观测数据权限 |
| 404 | `OPS_REQUEST_NOT_FOUND`、`OPS_API_ROUTE_NOT_FOUND` | 请求或接口不存在 |
| 503 | `OPS_ADMISSION_NOT_CONFIGURED` | 访问控制未配置 |
| 503 | `OPS_STATUS_STORE_UNAVAILABLE` | PostgreSQL 读取不可用 |
| 503 | `OPS_OBSERVABILITY_UNAVAILABLE` | OpenObserve 查询不可用 |
| 500 | `OPS_API_INTERNAL_ERROR` | 未分类服务端错误 |

### 状态值

健康状态为 `HEALTHY`、`DEGRADED`、`OUTAGE` 或 `UNKNOWN`。

数据状态为：

- `FRESH`：本次读取成功；
- `STALE`：返回最近一次成功结果；
- `NO_DATA`：读取成功但没有记录；
- `UNAVAILABLE`：来源未配置、连接失败、超时或响应无效。

请求状态为 `COMPLETED`、`FAILED`、`CANCELLED`、`RUNNING` 或 `PENDING`。

## `GET /api/ops/overview`

### 概况查询参数

| 参数 | 必填 | 允许值 | 默认值 |
| --- | --- | --- | --- |
| `window` | 否 | `15m`、`1h`、`6h`、`24h` | `1h` |

未知参数或无效值返回 `400 OPS_INVALID_QUERY`。

### 概况响应

- `window`：实际时间窗口。
- `generatedAt`：结果生成时间。
- `cache`：`status` 为 `FRESH` 或 `STALE`，`ageMs` 为缓存年龄。
- `health`：整体 `status`、`dataState` 和 `reasons[]`。
- `issues[]`：`code`、`title`、`detail`、`severity` 和 `source`。
- `requests`：请求总数、各状态数量、成功率、95% 耗时、状态、原因和更新时间。
- `trends[]`：时间桶开始时间、请求数、完成数、失败数和 95% 耗时。
- `services[]`：固定服务名、显示名、状态、数据状态、原因和更新时间。
- `temporal`：总积压、最老任务等待、工作进程数量、状态和 `queues[]`。
- `telemetry`：总体状态及日志、指标、调用链三类 `signals[]`。
- `externalLinks[]`：已配置系统的 `source`、`label`、`href` 和 `isAvailable`。

固定服务为 `campus-web`、`app-api`、`execution-control`、`agent-runtime` 和
`ops-web`。外部系统类型为 `TEMPORAL`、`LANGFUSE`、`SENTRY`、`AXIOM` 和
`OPENOBSERVE`。

服务端缓存概览 15 秒。PostgreSQL 和运行信号都失败且最近一次成功结果不超过五分钟时，
返回 `STALE`；否则各失败来源标为 `UNAVAILABLE`，其他来源继续返回。

## `GET /api/ops/requests`

### 请求列表查询参数

| 参数 | 必填 | 约束 | 默认值 |
| --- | --- | --- | --- |
| `window` | 否 | `1h`、`6h`、`24h`、`7d` | `1h` |
| `status` | 否 | 请求状态值 | 无 |
| `requestId` | 否 | 1 至 128 字符 | 无 |
| `conversationId` | 否 | 1 至 128 字符 | 无 |
| `traceId` | 否 | 1 至 128 字符 | 无 |
| `q` | 否 | 1 至 256 字符 | 无 |
| `limit` | 否 | 1 至 100 的整数 | `50` |
| `cursor` | 否 | 服务端游标，最多 512 字符 | 无 |

未知参数、无效状态或无效游标返回 `400 OPS_INVALID_QUERY`。`q` 只作用于服务端固定的
摘要字段，不能成为 SQL 片段。

### 请求列表响应

- `window`：实际时间窗口。
- `summary`：`total`、`completed`、`failed`、`cancelled`、`running`、`pending`。
- `data[]`：请求摘要。
- `page.nextCursor`：下一页游标，没有下一页时为 `null`。

每条请求摘要包含：

- `requestId`、`conversationId`、`traceId`；
- 可为空的 `runId`、`workflowId`；
- `status`、`errorCode`、`startedAt`、`completedAt`、`durationMs`、`projectedAt`；
- `principalType`、`principalHash`、`questionPreview`、`diagnostics[]`；
- 可为空的 `requestedTool`、`selectedTool`。

`principalHash` 使用服务端版本化 HMAC 生成，不能返回原始用户 ID。

## `GET /api/ops/requests/:requestId`

`requestId` 只允许字母、数字、点、下划线、冒号和连字符，最长 128 字符。无效 ID
返回 `400 OPS_INVALID_REQUEST_ID`，不存在返回 `404 OPS_REQUEST_NOT_FOUND`。

响应包含：

- `request`：请求摘要。
- `correlationIds`：`requestId`、`conversationId`、`traceId`，可为空的 `runId`、
  `workflowId`，以及 `missingCorrelationFields[]`。
- `modelSummary`：可为空的 `provider`、`model`、`promptId`、`promptVersion`、
  `templateSha256`。
- `toolSummary`：可为空的 `requestedTool`、`selectedTool`。
- `outcomeSummary`：可为空的 `semanticOutcome`、`refusalClass`、`scopeClass`。
- `policySummary`：可为空的 `aclDecision`、`aclAnomalyCode`、`failClosed`。
- `sources[]`：`canonicalUrl`、`sourceTitle`，以及可为空的 `sourceKind`、
  `targetKind`、`versionId`；最多十项。
- `stageTiming`：服务端接受的非负耗时键值。
- `stageTimingBudget`：每个耗时项对应 `OK`、`WARN` 或 `BREACH`。
- `workflowSummary`：可为空的模式、分支、首个决策者、规划结果和终止原因，另含
  `selectedTools[]` 与 `runtimeVersions`。
- `stepTrajectory[]`：`stepId`、`spanKind`、`status`、`retryCount`，以及可为空的
  `parentStepId`、`toolName`、`resultStatus`、`outcome`。
- `traceSummary`：`available`、`measuredAt`、`projectionLagMs`、`updatedAt`。
- `externalLinks[]`：服务端根据已保存关联标识和地址白名单生成的系统入口；不读取或返回
  持久化外部 URL/ref。

`workflowId` 仅在 `runId` 存在时按 `campus-agent.chat.<runId>` 生成。响应不返回
Temporal Run ID、任务队列、执行进程、token、费用、记忆摘要或检索候选统计。

## `GET /api/ops/requests/:requestId/observability`

该接口读取与已保存请求关联的 OpenObserve 原始记录。

| 参数 | 必填 | 允许值 |
| --- | --- | --- |
| `kind` | 是 | `logs`、`trace` |

服务端执行固定流程：

1. 验证基础权限和原始观测数据权限。
2. 按 URL 中的 `requestId` 读取请求详情。
3. 从详情取得 `requestId`、`traceId`、开始时间和完成时间。
4. 日志查询固定日志流，调用链查询固定调用链流。
5. 查询窗口从请求开始前五分钟到完成后五分钟；未完成请求以当前时间为上限。
6. 查询条件固定为保存的 `requestId`，按时间升序返回。
7. 成功返回前写入读取审计。

浏览器不能提供 SQL、数据流、`traceId`、起止时间或记录上限。

响应包含 `source=OPENOBSERVE`、`kind`、`requestId`、`traceId`、`from`、`to`、
`queriedAt`、`queryDurationMs`、`dataState`、`records[]`、`truncated` 和 `limit`。
日志上限固定为 200，调用链上限固定为 500。

每次成功读取前向 `observability.ops_observability_read_audit` 写入读取类型、操作者、
操作者类型、读取时间、记录数、请求 ID、调用链 ID 和是否截断。`ops_web` 账号只能
插入该表，不能读取、更新或删除审计记录。

读取审计保留 180 天。独立 `ops_audit_maintenance` 账号只能执行
`observability.prune_ops_observability_read_audit()`，不能直接访问审计表或业务表。

## 健康检查

### `GET /healthz`

只证明 Node 进程能响应，不访问依赖：

```json
{ "ok": true, "service": "ops-web" }
```

### `GET /readyz`

无需操作者 JWT，但必须检查：

- Cloudflare Access 域、受众、保护模式和至少一个基础操作者白名单；
- `ops_web` 账号能读取四个允许来源所需的列；
- `ops_web` 账号能在事务中插入审计测试记录并回滚。

失败返回 `503 OPS_WEB_NOT_READY` 及不含敏感信息的缺失项或 `reasonCode`。OpenObserve
和被观测服务的故障不影响 Pod 就绪，因为值班人员仍需要打开页面查看其他信息。

## PostgreSQL 权限

运行时使用专用 `ops_web` 账号。允许读取的来源只有：

- `operator.request_projection`
- `operator.temporal_task_queue_current`
- `runtime.request_execution`
- `runtime.request_observability_fact`

各表使用列级 `SELECT`，不得使用数据库 owner 账号。唯一写权限是向
`observability.ops_observability_read_audit` 插入。

非本地连接固定使用 `verify-full`：

- `OPS_WEB_DATABASE_CA_CERT_PATH` 指向 PostgreSQL CA；
- `OPS_WEB_DATABASE_URL` 不得携带 TLS 查询参数覆盖显式配置；
- `OPS_WEB_DATABASE_SSLMODE=disable` 只允许本地开发或测试。

数据库角色和授权由以下命令收敛并验证：

```bash
pnpm --dir apps/app-api exec tsx ./scripts/run-with-staging-db-env.ts \
  pnpm exec tsx ./ops/db/ops-web-database.ts apply
```

## 明确禁止

- 根据 OpenObserve、Temporal、Langfuse、Sentry 或 Axiom 数据改写请求状态。
- 让浏览器控制任意 OpenObserve 查询。
- 返回数据库地址、JWT、Cookie 或服务凭据。
- 恢复外部正文同步表、供应商响应缓存或通用观测查询接口。
- 为旧 `/runtime` 或 `/api/ops/evidence/*` 增加兼容路由。
