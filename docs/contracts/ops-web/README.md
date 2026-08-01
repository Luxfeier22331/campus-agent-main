---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Ops Web 接口

## 范围

本目录定义 `apps/ops-web` 服务端提供给自身页面的 HTTP 接口：

- [runtime.md](./runtime.md)：运行概况、运行记录和按需系统记录；
- [providers.md](./providers.md)：在线模型配置；
- [access.md](./access.md)：非校园邮箱准入授权；
- [users.md](./users.md)：用户、会话、账号操作记录和注销任务；
- 本文：固定内部门户认证状态与 TGC 替换。

食堂和同好群是内容运营能力，其接口与数据边界分别由
[食堂](../../product/dining.md) 和 [同好群](../../domains/groups.md) 说明。可执行合同位于 `apps/ops-web/src/server/app.ts` 和
`apps/ops-web/src/shared/`。环境变量、数据库授权和网络策略不由本目录维护。

## 接口索引

运行记录：

- `GET /api/ops/overview`
- `GET /api/ops/requests`
- `GET /api/ops/requests/:requestId`
- `GET /api/ops/requests/:requestId/observability`
- `GET /api/ops/requests/:requestId/sentry-issues`

模型配置：

- `GET /api/ops/model-settings/execution`
- `PUT /api/ops/model-settings/execution/:kind`
- `POST /api/ops/model-settings/execution/:kind/validate`

账号管理：

- `GET /api/ops/email-access-grants`
- `POST /api/ops/email-access-grants`
- `POST /api/ops/email-access-grants/:grantId/:action`
- `GET /api/ops/users`
- `GET /api/ops/users/:userId`
- `POST /api/ops/users/:userId/:action`
- `POST /api/ops/users/:userId/sessions/:sessionId/revoke`
- `GET /api/ops/account-events`
- `GET /api/ops/account-deletions`
- `POST /api/ops/account-deletions/:requestId/retry`

内部门户认证：

- `GET /api/ops/internal-portal/auth`
- `PUT /api/ops/internal-portal/auth`

同好群：

- `GET /api/ops/groups/catalog`
- `PUT /api/ops/groups/catalog`

健康检查：

- `GET /healthz`
- `GET /readyz`

## 通用规则

### 身份和权限

- `/api/ops/*` 验证 Cloudflare Access JWT 的签发方、受众和签名。
- Cloudflare Access policy 决定人员范围；服务端只接受 `type=app` 且 `sub` 非空的人员应用令牌，
  拒绝 `sub` 为空的服务令牌，不复制人员、组或分接口白名单。
- 所有接口使用同一人员准入。写接口另外执行同源、正文、并发和领域校验。
- 浏览器不持有 PostgreSQL、Axiom、在线模型配置管理接口或外部平台凭据。

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
    "message": "运行记录查询参数无效。"
  }
}
```

主要错误码：

| HTTP | 错误码 | 含义 |
| ---: | --- | --- |
| 400 | `OPS_INVALID_QUERY` | 查询参数或游标无效 |
| 400 | `OPS_INVALID_REQUEST_ID` | 请求 ID 格式无效 |
| 400 | `OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED`、`OPS_MODEL_SETTINGS_PRECONDITION_REQUIRED` | 在线模型配置写入合同无效 |
| 400 | `OPS_INTERNAL_PORTAL_AUTH_QUERY_INVALID`、`OPS_INTERNAL_PORTAL_AUTH_CONTENT_TYPE_REQUIRED`、`OPS_INTERNAL_PORTAL_AUTH_INVALID` | 内部门户认证查询或正文无效 |
| 400 | `OPS_DINING_QUERY_INVALID`、`OPS_DINING_DRAFT_INVALID`、`OPS_DINING_PUBLISH_INVALID`、`OPS_DINING_RESTORE_INVALID`、`OPS_DINING_MENU_INVALID`、`OPS_DINING_REVIEW_INVALID`、`OPS_DINING_REPORT_INVALID`、`OPS_DINING_INVALID` | Dining 查询、正文或内容无效 |
| 400 | `OPS_CAMPUS_GROUPS_REQUEST_INVALID` | 同好群目录正文无效 |
| 401 | `OPS_ACCESS_JWT_MISSING`、`OPS_ACCESS_JWT_INVALID` | 未通过 Access 验证 |
| 403 | `OPS_PROVIDER_CONFIG_CSRF_REJECTED` | 在线模型配置写请求不同源 |
| 403 | `OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID` | 内部门户认证写请求不同源 |
| 403 | `OPS_ACCOUNT_ADMIN_CSRF_REJECTED`、`OPS_EMAIL_ACCESS_CSRF_REJECTED` | 账号管理写请求不同源 |
| 403 | `OPS_DINING_ORIGIN_INVALID` | Dining 写请求不同源 |
| 404 | `OPS_REQUEST_NOT_FOUND`、`OPS_API_ROUTE_NOT_FOUND`、`OPS_DINING_NOT_FOUND` | 请求、接口或地图版本不存在 |
| 409 | `OPS_PROVIDER_CONFIG_CONFLICT` | 模型配置已被其他操作更新 |
| 409 | `OPS_DINING_CONFLICT` | 草稿、发布或评价操作违反领域校验 |
| 503 | `OPS_ADMISSION_NOT_CONFIGURED` | 访问控制未配置 |
| 503 | `OPS_STATUS_STORE_UNAVAILABLE` | PostgreSQL 读取不可用 |
| 503 | `OPS_OBSERVABILITY_UNAVAILABLE` | Axiom 查询未配置、失败、超时或响应无效 |
| 503 | `OPS_SENTRY_UNAVAILABLE` | Sentry Issue 查询未配置、失败或响应无效 |
| 503 | `OPS_PROVIDER_CONFIG_UNAVAILABLE` | execution-control admin 未配置或不可用 |
| 503 | `OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE` | 固定 Secret 或认证 CronJob 不可用 |
| 503 | `OPS_ACCOUNT_ADMIN_UNAVAILABLE`、`OPS_EMAIL_ACCESS_UNAVAILABLE` | App API 账号管理接口未配置或不可用 |
| 503 | `OPS_DINING_STORE_UNAVAILABLE` | Dining PostgreSQL 不可用 |
| 503 | `OPS_CAMPUS_GROUPS_UNAVAILABLE` | App API 同好群管理接口未配置或不可用 |
| 503 | `OPS_WEB_NOT_READY` | Ops Web 核心依赖未就绪 |
| 500 | `OPS_API_INTERNAL_ERROR` | 未分类服务端错误 |

### 状态值

健康状态为 `HEALTHY`、`DEGRADED`、`OUTAGE` 或 `UNKNOWN`。

数据状态为：

- `FRESH`：本次读取成功；
- `PARTIAL`：同一来源的部分固定查询成功、部分失败；
- `STALE`：返回最近一次成功结果；
- `NO_DATA`：读取成功但没有记录；
- `UNAVAILABLE`：来源未配置、连接失败、超时或响应无效。

`/api/ops/overview` 将请求与 Temporal、服务探针、Axiom 观测覆盖作为三个独立读取面。每个读取面
拥有独立超时、短期缓存和旧数据回退；一个读取面失败不能把另一个读取面的最新结果标记为旧数据。
`health` 只汇总产品与服务可用性，Axiom 观测覆盖不参与产品整体健康判断。`issues[]` 是页面唯一的
根因摘要，`health` 和各状态表不复制同一错误说明。未配置的服务探针不返回虚构的未知服务行。
服务探针配置为 HTTP(S) 服务根地址，由服务端固定请求 `/readyz`。HTTP 2xx 且 JSON `status` 为
`ready` 或 `ok` 才表示
健康；有效 JSON 的 5xx readiness 响应表示已确认不可用。网络错误、超时、4xx、重定向登录页和
无效响应均表示当前无法读取状态，不得伪装成已确认的服务故障。

请求状态为 `COMPLETED`、`FAILED`、`CANCELLED`、`RUNNING`、`PENDING` 或 `ACTION_REQUIRED`。
`ACTION_REQUIRED` 是终态，表示需要用户补充信息或审批；不会继续自动执行或被当作活动请求轮询。

## 内部门户认证

`GET /api/ops/internal-portal/auth` 不接受查询参数，返回：

```json
{
  "credentialUpdatedAt": "2026-07-27T10:00:00.000Z",
  "currentCredentialChecked": true,
  "lastScheduledAt": "2026-07-27T10:30:00.000Z",
  "lastSuccessfulAt": "2026-07-27T10:30:04.000Z",
  "latestRun": "succeeded"
}
```

`latestRun` 为 `never_run`、`running`、`succeeded` 或 `failed`。`lastSuccessfulAt` 只表示最近一次
成功使用；`currentCredentialChecked` 只在最新成功 Job 的调度时间不早于凭据更新时间时为
`true`。两者都不承诺 TGC 当前仍有效，也不提供过期时间。

`PUT /api/ops/internal-portal/auth` 只接受同源 `application/json`：

```json
{ "ssoTgc": "TGT-..." }
```

`ssoTgc` 必须是最多 4096 字节的原始可打印 Cookie 值，不能包含 `SSO_TGC=`、空白、引号、逗号、
分号或反斜杠。成功响应使用相同状态合同，将 `credentialUpdatedAt` 更新为本次写入时间并将
`currentCredentialChecked` 设为 `false`；响应不返回 TGC、摘要或末尾字符。服务端只读取和 patch
固定 Secret `source-collector-internal-portal-auth`，只读取固定 CronJob
`source-collector-auth-check`，不会创建即时 Job。

## 健康检查

`GET /healthz` 只证明 Node 进程能响应，不访问依赖：

```json
{ "ok": true, "service": "ops-web" }
```

`GET /readyz` 无需操作者 JWT，检查 Cloudflare Access 验证配置、合法的
`OPS_WEB_PUBLIC_ORIGIN` 和请求状态 PostgreSQL。失败返回 `503 OPS_WEB_NOT_READY` 及不含敏感信息的
缺失项或稳定 `reasonCode`。Temporal、Axiom、Sentry、在线模型配置、内部门户认证资源、Dining
和被观测服务故障不影响 Pod 就绪；它们在所属读取面或页面返回明确的不可用状态。

## 禁止行为

- 根据 Axiom、Temporal、Langfuse 或 Sentry 数据改写请求状态。
- 让浏览器控制任意 APL、dataset、字段投影、时间窗口或返回上限。
- 返回数据库地址、JWT、Cookie 或服务凭据。
- 让浏览器持有在线模型配置凭据、直接写配置数据库或选择任意 Kubernetes 资源。
- 创建、列举或删除 Kubernetes Secret，读取或 patch 固定内部门户 Secret 之外的 Secret，或者
  读取固定认证 CronJob 之外的 Kubernetes workload。
- 选择或操作任意 Temporal Schedule、Workflow 或 Activity。
- 同步外部观测正文、缓存供应商响应或提供通用观测查询接口。

## 相关文档

- `../../product/ops-web.md`
- `../../architecture/system/ops-observability.md`
- `../../data/postgres-ownership.md`
- [Cloudflare Access Application Token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
