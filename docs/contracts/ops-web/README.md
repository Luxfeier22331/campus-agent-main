---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Ops Web 接口

## 范围

本目录定义 `apps/ops-web` 服务端提供给自身页面的 HTTP 接口：

- [runtime.md](./runtime.md)：运行概况、请求排查和观测记录；
- [providers.md](./providers.md)：在线 Provider Config；
- [ingestion.md](./ingestion.md)：采集任务与内部门户离线发布；
- [portal.md](./portal.md)：固定门户认证；
- [dining.md](./dining.md)：Dining 内容运营。

可执行合同位于 `apps/ops-web/src/server/app.ts`、`apps/ops-web/src/shared/ops-contract.ts` 和
`apps/ops-web/src/shared/dining-contract.ts`。环境变量、数据库授权和网络策略不由本目录维护。

## 接口索引

运行排查：

- `GET /api/ops/overview`
- `GET /api/ops/requests`
- `GET /api/ops/requests/:requestId`
- `GET /api/ops/requests/:requestId/observability`
- `GET /api/ops/requests/:requestId/sentry-issues`

Provider Config：

- `GET /api/ops/provider-config`
- `POST /api/ops/provider-config/connections`
- `POST /api/ops/provider-config/profiles`
- `POST /api/ops/provider-config/profiles/:profileId/validate`
- `POST /api/ops/provider-config/activation`

门户认证：

- `GET /api/ops/internal-portal-auth`
- `PUT /api/ops/internal-portal-auth`
- `POST /api/ops/internal-portal-auth/maintenance/validate`

采集运行：

- `GET /api/ops/ingestion/status`
- `GET /api/ops/ingestion/tasks`
- `GET /api/ops/ingestion/tasks/:taskId`
- `POST /api/ops/ingestion/tasks/:taskId/retry`
- `POST /api/ops/ingestion/notice/{pause|resume}`
- `POST /api/ops/ingestion/notice/reconcile`
- `POST /api/ops/ingestion/file-releases`

Dining：

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

健康检查：

- `GET /healthz`
- `GET /readyz`

## 通用规则

### 身份和权限

- `/api/ops/*` 验证 Cloudflare Access JWT 的签发方、受众和签名。
- Cloudflare Access policy 决定人员范围；服务端拒绝 `type=app` 服务身份，不复制人员、组或
  分接口白名单。
- 所有接口使用同一人员准入。写接口另外执行同源、正文、幂等和领域校验。
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
| 403 | `OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID` | 门户凭据写请求不同源 |
| 403 | `OPS_PROVIDER_CONFIG_CSRF_REJECTED` | Provider Config 写请求不同源 |
| 404 | `OPS_REQUEST_NOT_FOUND`、`OPS_API_ROUTE_NOT_FOUND` | 请求或接口不存在 |
| 409 | `OPS_DINING_CONFLICT` | 草稿、发布或评价操作违反领域校验 |
| 503 | `OPS_ADMISSION_NOT_CONFIGURED` | 访问控制未配置 |
| 503 | `OPS_STATUS_STORE_UNAVAILABLE` | PostgreSQL 读取不可用 |
| 503 | `OPS_OBSERVABILITY_UNAVAILABLE` | Axiom 查询未配置、失败、超时或响应无效 |
| 503 | `OPS_SENTRY_UNAVAILABLE` | Sentry Issue 查询未配置、失败或响应无效 |
| 503 | `OPS_PROVIDER_CONFIG_UNAVAILABLE` | execution-control admin 未配置或不可用 |
| 503 | `OPS_INTERNAL_PORTAL_AUTH_NOT_INITIALIZED`、`OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE` | 固定 Secret 未初始化或 Kubernetes API 不可用 |
| 503 | `OPS_INTERNAL_PORTAL_AUTH_MAINTENANCE_UNAVAILABLE` | 固定认证维护任务查询或验证不可用 |
| 503 | `OPS_INGESTION_UNAVAILABLE` | ingestion-control 未配置或不可用 |
| 503 | `OPS_DINING_STORE_UNAVAILABLE` | Dining PostgreSQL 不可用 |
| 503 | `OPS_WEB_NOT_READY` | Ops Web 核心依赖未就绪 |
| 500 | `OPS_API_INTERNAL_ERROR` | 未分类服务端错误 |

### 状态值

健康状态为 `HEALTHY`、`DEGRADED`、`OUTAGE` 或 `UNKNOWN`。

数据状态为：

- `FRESH`：本次读取成功；
- `STALE`：返回最近一次成功结果；
- `NO_DATA`：读取成功但没有记录；
- `UNAVAILABLE`：来源未配置、连接失败、超时或响应无效。

请求状态为 `COMPLETED`、`FAILED`、`CANCELLED`、`RUNNING` 或 `PENDING`。

## 健康检查

`GET /healthz` 只证明 Node 进程能响应，不访问依赖：

```json
{ "ok": true, "service": "ops-web" }
```

`GET /readyz` 无需操作者 JWT，但必须检查访问控制配置、请求状态读取和 Dining 当前发布读取
是否可用。失败返回 `503 OPS_WEB_NOT_READY` 及不含敏感信息的缺失项或 `reasonCode`。
Provider Config、Axiom、Kubernetes API、认证维护接口和被观测服务故障不影响 Pod 就绪。

## 禁止行为

- 根据 Axiom、Temporal、Langfuse 或 Sentry 数据改写请求状态。
- 让浏览器控制任意 APL、dataset、字段投影、时间窗口或返回上限。
- 返回数据库地址、JWT、Cookie 或服务凭据。
- 让浏览器持有 Provider Config 凭据、直接写配置数据库或激活部分 role bundle。
- 创建、列举、删除 Secret，或更新固定门户 Secret 以外的 Secret。
- 选择任意 Schedule、立即触发认证维护工作流或发送其他 Temporal 命令。
- 同步外部观测正文、缓存供应商响应或提供通用观测查询接口。

## 相关文档

- `../../product/ops-web.md`
- `../../architecture/system/ops-observability.md`
- `../../data/postgres-ownership.md`
