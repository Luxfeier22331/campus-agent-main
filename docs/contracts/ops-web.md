---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Ops Web 接口

## 范围

本文定义 `apps/ops-web` 服务端提供给自身页面的 HTTP 接口。可执行合同位于
`apps/ops-web/src/server/app.ts` 和 `apps/ops-web/src/shared/ops-contract.ts`。

主要接口族为：

- `GET /api/ops/overview`
- `GET /api/ops/provider-config`
- `POST /api/ops/provider-config/connections`
- `POST /api/ops/provider-config/profiles`
- `POST /api/ops/provider-config/profiles/:profileId/validate`
- `POST /api/ops/provider-config/activation`
- `GET /api/ops/requests`
- `GET /api/ops/requests/:requestId`
- `GET /api/ops/requests/:requestId/observability`
- `GET /api/ops/internal-portal-auth`
- `PUT /api/ops/internal-portal-auth`
- `POST /api/ops/internal-portal-auth/maintenance/resume`
- `GET /api/ops/dining/overview`
- `GET /api/ops/dining/source-runs`
- `GET /api/ops/dining/observations`
- `GET /api/ops/dining/catalog/draft`
- `GET /api/ops/dining/catalog/draft/validation`
- `POST /api/ops/dining/catalog/draft/rebase`
- `POST /api/ops/dining/catalog/draft/commands`
- `POST /api/ops/dining/catalog/publish`
- `GET /api/ops/dining/releases`
- `GET /api/ops/dining/releases/:releaseId`
- `POST /api/ops/dining/releases/:releaseId/rollback`
- `GET /api/ops/dining/reviews`
- `GET /api/ops/dining/reviews/:reviewId`
- `POST /api/ops/dining/reviews/:reviewId/commands`
- `GET /healthz`
- `GET /readyz`

不存在 `/api/ops/runtime`、`/api/ops/evidence/*` 或通用查询代理。

## 通用规则

### 身份和权限

- `/api/ops/*` 验证 Cloudflare Access JWT 的签发方、受众和签名。
- JWT 对应的人员邮箱或服务令牌 ID 必须进入基础操作者白名单。
- 原始日志和调用链读取还必须进入独立的原始观测数据白名单。
- 内部门户认证接口只允许基础白名单中的人员身份，服务令牌不能调用。
- Provider Config 读取允许已准入人员或服务身份；写入还要求独立人员邮箱/组白名单。
- 浏览器不持有 PostgreSQL、Axiom、Provider Config admin 或外部平台凭据。

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
| 400 | `OPS_INTERNAL_PORTAL_AUTH_INPUT_INVALID` | 凭据正文无效或超过 8 KiB |
| 400 | `OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED`、`OPS_PROVIDER_CONFIG_IDEMPOTENCY_REQUIRED` | Provider Config 写入合同无效 |
| 401 | `OPS_ACCESS_JWT_MISSING`、`OPS_ACCESS_JWT_INVALID` | 未通过 Access 验证 |
| 403 | `OPS_RAW_OBSERVABILITY_FORBIDDEN` | 无原始观测数据权限 |
| 403 | `OPS_INTERNAL_PORTAL_AUTH_FORBIDDEN`、`OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID` | 无人员权限或请求不同源 |
| 403 | `OPS_PROVIDER_CONFIG_WRITE_FORBIDDEN`、`OPS_PROVIDER_CONFIG_CSRF_REJECTED` | 无配置写权限或请求不同源 |
| 404 | `OPS_REQUEST_NOT_FOUND`、`OPS_API_ROUTE_NOT_FOUND` | 请求或接口不存在 |
| 503 | `OPS_ADMISSION_NOT_CONFIGURED` | 访问控制未配置 |
| 503 | `OPS_STATUS_STORE_UNAVAILABLE` | PostgreSQL 读取不可用 |
| 503 | `OPS_OBSERVABILITY_UNAVAILABLE` | Axiom 查询未配置、失败、超时或返回 partial/无效响应 |
| 503 | `OPS_PROVIDER_CONFIG_UNAVAILABLE` | execution-control admin 未配置或不可用 |
| 503 | `OPS_INTERNAL_PORTAL_AUTH_NOT_INITIALIZED`、`OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE` | 固定 Secret 未初始化或 Kubernetes API 不可用 |
| 503 | `OPS_INTERNAL_PORTAL_AUTH_MAINTENANCE_UNAVAILABLE` | 固定 Temporal Schedule 查询或恢复不可用 |
| 503 | `OPS_DINING_STORE_UNAVAILABLE` | Dining PostgreSQL 不可用 |
| 409 | `OPS_DINING_CONFLICT` | 草稿、发布或评价操作违反领域校验 |
| 500 | `OPS_API_INTERNAL_ERROR` | 未分类服务端错误 |

### 状态值

健康状态为 `HEALTHY`、`DEGRADED`、`OUTAGE` 或 `UNKNOWN`。

数据状态为：

- `FRESH`：本次读取成功；
- `STALE`：返回最近一次成功结果；
- `NO_DATA`：读取成功但没有记录；
- `UNAVAILABLE`：来源未配置、连接失败、超时或响应无效。

请求状态为 `COMPLETED`、`FAILED`、`CANCELLED`、`RUNNING` 或 `PENDING`。

## 在线 Provider Config

`GET /api/ops/provider-config` 返回 active revision、connection revisions、profiles、三个在线
role 的配置状态、采样时间和当前 principal 的 `writeAllowed`。role 只允许
`primary_agent`、`rag_query_embedding` 和可选 `rag_reranker`。connection 只暴露 API key
末四位和 fingerprint，不返回密钥或密文。

四类 `POST` 命令分别创建不可变 connection revision、创建 profile、验证 profile 和激活完整
bundle。每次命令必须满足：

- 当前 principal 是独立写白名单中的人员；
- Origin 与 `OPS_WEB_PUBLIC_ORIGIN` 一致，正文为 JSON；
- `Idempotency-Key` 非空且不超过 200 字符；
- 激活提供当前 `expectedRevision`，包含 required role，并只引用验证通过的 profile。

Ops Web 将人员标识和幂等键转发给 execution-control admin。上游冲突、校验和失败状态原样保留，
不转换为成功空数据；浏览器不能指定 admin URL、token、数据库角色或 keyring。

## 内部门户认证

### `GET /api/ops/internal-portal-auth`

返回固定 Secret 元数据、固定 Temporal Schedule 摘要和观测生命周期，不返回 Secret data、
TGC 或 Service Ticket：

```json
{
  "configured": true,
  "updatedAt": "2026-07-15T12:00:00.000Z",
  "updatedBy": "operator@example.com",
  "maintenance": {
    "scheduleState": "ACTIVE",
    "nextRunAt": "2026-07-15T13:00:00.000Z",
    "lastAttemptAt": "2026-07-15T12:30:00.000Z",
    "lastOutcome": "SUCCESS",
    "lastSuccessAt": "2026-07-15T12:30:03.000Z",
    "serviceTicketIssued": true,
    "portalSessionEstablished": true,
    "noticeProbeSucceeded": true,
    "errorCode": null
  },
  "observedLifetime": {
    "lowerBoundSeconds": 1803,
    "upperBoundSeconds": null
  }
}
```

Secret 不存在时返回 `configured=false`；Kubernetes API 不可用时返回 `503`，但不影响
Ops Web 的其他接口或 `/readyz`。Temporal 查询不可用时 `maintenance.scheduleState` 为
`UNAVAILABLE`，仍返回 Secret 元数据。

### `PUT /api/ops/internal-portal-auth`

请求必须同源、正文不超过 8 KiB，并包含：

```json
{ "credential": "raw SSO_TGC or Cookie header" }
```

服务端接受原始 TGC 或包含且只包含一个 `SSO_TGC` 的 Cookie 字符串。校验后只对
`source-collector-internal-portal-auth` 执行 JSON Patch，写入 `data.sso_tgc`、更新时间和
更新人 annotation。成功响应与 GET 相同，不回显凭据。接口不创建 Secret、不在线验证门户
登录、不保存旧值，也不提供回滚。Secret 更新成功后服务端幂等恢复已暂停的 Schedule；恢复
失败不会撤销凭据更新，响应以 `UNAVAILABLE` 显示维护状态。

### `POST /api/ops/internal-portal-auth/maintenance/resume`

人员操作者可以同源调用该接口，重试恢复固定
`internal-portal-auth-maintenance` Schedule。接口不接受 Schedule ID、Workflow ID 或凭据，
不立即触发运行；成功响应与 GET 相同。

`lowerBoundSeconds` 是当前凭据更新时间到最近一次成功 Service Ticket 签发的时间；首次确认
过期后才产生 `upperBoundSeconds`。这是约 30 分钟精度的观测区间，不是 CAS 配置声明。

## Axiom 查询配置

Ops Web 服务端只在以下配置全部存在且有效时启用 Axiom 查询：

- `OPS_WEB_AXIOM_EDGE_URL`：HTTPS Axiom Edge base URL、`/v1` URL 或精确的
  `/v1/query/_apl?format=tabular`；不得带 credential、fragment 或额外 query。
- `OPS_WEB_AXIOM_LOGS_DATASET`、`OPS_WEB_AXIOM_TRACES_DATASET`、
  `OPS_WEB_AXIOM_METRICS_DATASET`：固定 dataset 名，只允许字母、数字、下划线和连字符。
- `OPS_WEB_AXIOM_QUERY_TOKEN`：限定上述 dataset 的 query-only token；以 `xapt-` 开头的 personal
  token 明确拒绝。
- `OPS_WEB_AXIOM_QUERY_TIMEOUT_MS`：可选，默认 5000 毫秒，范围为 1 至 30000 毫秒。

这些值只由服务端环境提供。浏览器不能覆盖 endpoint、token、dataset 或 timeout。Ops Web
不得复用 Collector ingest token、Axiom Terraform token 或 Cloudflare application-log destination
token。

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
`ops-web`。外部系统类型为 `TEMPORAL`、`LANGFUSE`、`SENTRY` 和 `AXIOM`。

服务端缓存概览 15 秒。PostgreSQL 和运行信号都失败且最近一次成功结果不超过五分钟时，
返回 `STALE`；否则各失败来源标为 `UNAVAILABLE`，其他来源继续返回。

三类 telemetry signal 分别对固定 Axiom dataset 执行只包含 `count()` 与最新 `_time` 的 APL。
任一查询失败只将该 signal 标为 `UNAVAILABLE`；其他成功查询继续返回。日志或调用链为零条时
返回 `NO_DATA` 且不自动判为故障，指标为零条时返回 `NO_DATA` 与 `DEGRADED`。Axiom 对所有
dataset 均不可用时，telemetry 总体状态为 `UNAVAILABLE`/`UNKNOWN`。

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
- `outcomeSummary`：可为空的 `semanticOutcome`、`refusalClass`，以及
  `resolvedTargets[]`。
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

该接口读取与已保存请求关联的 Axiom 脱敏记录。

| 参数 | 必填 | 允许值 |
| --- | --- | --- |
| `kind` | 是 | `logs`、`trace` |

服务端执行固定流程：

1. 验证基础权限和原始观测数据权限。
2. 按 URL 中的 `requestId` 读取请求详情。
3. 从详情取得 `requestId`、`traceId`、开始时间和完成时间。
4. 日志查询固定 log dataset，调用链查询固定 trace dataset。
5. 查询窗口从请求开始前五分钟到完成后五分钟；未完成请求以当前时间为上限，并将实际
   查询窗口限制在最多 30 分钟。
6. 查询条件固定为保存的 `requestId`，字段投影固定并按时间升序返回。
7. 成功返回前写入读取审计。

浏览器不能提供 APL、dataset、`traceId`、起止时间、字段投影或记录上限。

响应包含 `source=AXIOM`、`kind`、`requestId`、`traceId`、`from`、`to`、
`queriedAt`、`queryDurationMs`、`dataState`、`records[]`、`truncated` 和 `limit`。
日志上限固定为 200，调用链上限固定为 500。

日志记录只投影 `timestamp`、`service.name`、`severity_text`、`body`、`trace_id`、
`span_id` 和 `request_id`。调用链记录只投影 `timestamp`、`service.name`、`name`、`kind`、
`duration`、`status.code`、`error`、`trace_id`、`span_id`、`parent_span_id` 和
`request_id`。服务端实际查询 `limit + 1` 条以判断截断，再裁剪到合同上限。

Axiom 必须返回非 partial 的 tabular JSON。`status.isPartial` 不是 `false`、表结构无效、字段
重复、列长度错位、超时或非成功 HTTP 时，接口返回
`503 OPS_OBSERVABILITY_UNAVAILABLE`，不得把已解析的部分行返回给浏览器。

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
- `ops_web_dining` 账号能读取 `dining.publication`。

失败返回 `503 OPS_WEB_NOT_READY` 及不含敏感信息的缺失项或 `reasonCode`。Provider Config
admin、Axiom、Kubernetes API、认证维护接口和被观测服务的故障不影响 Pod 就绪，因为
值班人员仍需要打开页面查看其他信息。

## PostgreSQL 权限

运行时使用专用 `ops_web` 账号。允许读取的来源只有：

- `chat.turn_dispatches`
- `chat.messages`
- `runtime.agent_runs`
- `runtime.request_observability_fact`

各表使用列级 `SELECT`，不得使用数据库 owner 账号。唯一写权限是向
`observability.ops_observability_read_audit` 插入。

Dining 使用独立 `ops_web_dining` 账号、连接池和 TLS 配置。它可读 Dining 全表并写 catalog、
release、override、review 和 bounded operation events，但不能创建 schema。不得把
`OPS_WEB_DATABASE_URL` 与 `OPS_WEB_DINING_DATABASE_URL` 合并为一个 owner 账号。

非本地连接固定使用 `verify-full`：

- `OPS_WEB_DATABASE_CA_CERT_PATH` 指向 PostgreSQL CA；
- `OPS_WEB_DATABASE_URL` 不得携带 TLS 查询参数覆盖显式配置；
- `OPS_WEB_DATABASE_SSLMODE=disable` 只允许本地开发或测试。

数据库角色和授权由以下命令收敛并验证：

```bash
pnpm --dir apps/ops-web exec tsx ./ops/db/ops-web-database.ts apply
```

## 网络出站合同

Ops Web Pod 使用 `campus-agent.muc.wiki/network-policy-profile=ops-web`。execution-runtime 和
ingestion-runtime 中以 `app.kubernetes.io/part-of=campus-agent` 选取 Pod 的宽策略必须同时用
`DoesNotExist` 排除所有拥有专用网络 profile 的 Pod；NetworkPolicy 的允许规则会取并集，新增
Ops Web 策略本身不能抵消其他策略已经允许的流量。

源码 base 只允许以下集群内依赖：

| 依赖 | 目标 | 端口 | 消费方 |
| --- | --- | ---: | --- |
| DNS | `kube-system` namespace | UDP/TCP 53 | Service、Axiom 与 Access 域名解析 |
| PostgreSQL | `cnpg.io/cluster=campus-agent-postgres` | TCP 5432 | 请求摘要和读取审计 |
| execution-control | `app.kubernetes.io/name=execution-control` | TCP 8000 | Temporal task queue 摘要 |
| execution-control admin | `app.kubernetes.io/name=execution-control-admin` | TCP 8000 | Provider Config BFF |
| ingestion-control | `app.kubernetes.io/name=ingestion-control` | TCP 8000 | 固定认证维护 Schedule 状态与恢复 |

`automountServiceAccountToken=false` 不表示 Ops Web 无需 Kubernetes API。Deployment 显式投影
短期 ServiceAccount token、CA 和 namespace，`@kubernetes/client-node` 用它对固定
`source-collector-internal-portal-auth` Secret 执行 `get`/`patch`。因此环境 overlay 必须按该
集群实际 Kubernetes API Service IP 单独允许 TCP 443，不得在 namespace-neutral base 写入环境
地址。

staging 还有两个实际公网 HTTPS 消费者：Axiom Edge 查询，以及 `jose` 从环境固定的
`ACCESS_TEAM_DOMAIN/cdn-cgi/access/certs` 读取 Cloudflare Access JWKS。标准 Kubernetes
NetworkPolicy 不能按 FQDN 约束目标；当前环境采用仓库既有的 `ipBlock` HTTPS 方式，并排除
RFC 1918、loopback、link-local、CGNAT 和其他非公网地址。该规则仍允许任意公网 IPv4 的 TCP
443，不是 Axiom 或 Cloudflare Access 域名级隔离。应用层只接受环境提供的 HTTPS endpoint，
浏览器不能覆盖 URL；Axiom 凭据为 dataset 限定的 query-only token。若要求网络层域名隔离，
必须先引入受支持且受测试的 FQDN 感知 CNI 策略或带目标白名单的 egress proxy，不能把启动时
解析出的动态 IP 当作稳定合同。

专用 profile 只把 Ops Web 从宽策略的目标 Pod 选择中排除，不改变其他服务 ingress 规则中的
来源选择；Ops Web 仍保留 `app.kubernetes.io/part-of=campus-agent`，并通过上述精确 egress
规则调用 PostgreSQL、execution-control 和 ingestion-control。Ops Web 自身 ingress 只由环境
tunnel 策略开放。

发布时必须把 GitOps 中 ops-web、execution-runtime 和 ingestion-runtime 三个 source ref 原子
推进到同一包含本合同的 commit。只推进 Ops Web 会被旧宽策略重新放开，只推进宽策略排除则会
在 Ops Web 专用 allowlist 尚未生效时阻断依赖。新增任何健康检查或服务端出站消费者时，必须先
同步本合同和对应 NetworkPolicy。

## 明确禁止

- 根据 Axiom、Temporal、Langfuse 或 Sentry 数据改写请求状态。
- 让浏览器控制任意 APL、dataset、字段投影、时间窗口或返回上限。
- 返回数据库地址、JWT、Cookie 或服务凭据。
- 让浏览器持有 Provider Config token/keyring、直接写配置数据库或激活部分 role bundle。
- 创建、列举、删除 Secret，或更新固定门户 Secret 以外的 Secret。
- 选择任意 Schedule、立即触发认证维护工作流或发送其他 Temporal 命令。
- 恢复外部正文同步表、供应商响应缓存或通用观测查询接口。
- 恢复 OpenObserve 查询、凭据或兼容路由。
- 为旧 `/runtime` 或 `/api/ops/evidence/*` 增加兼容路由。
