---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Ops Web 接口

本目录定义 Ops Web 服务端提供给自身页面的 HTTP 接口：

- [runtime.md](./runtime.md)：运行概况、运行记录和运行详情中的持久执行诊断；
- [chat-feedback.md](./chat-feedback.md)：回答反馈筛选、统计和对应问答的只读查询；
- [providers.md](./providers.md)：在线模型配置；
- [internal-portal.md](./internal-portal.md)：内部门户凭据与自动化 token；
- [notices.md](./notices.md)：通知库存、分类维护和 Temporal 固定维护操作入口；
- [access.md](./access.md)：非校园邮箱准入；
- [users.md](./users.md)：用户、会话、账号操作记录和只读注销状态。

食堂和同好群分别由 [食堂产品文档](../../product/dining.md) 和
[同好群领域文档](../../domains/groups.md) 维护。可执行路由与 DTO 位于
`apps/ops-web/src/server/app.ts` 和 `apps/ops-web/src/shared/`。

## 共享规则

- `/api/ops/*` 接受经过 Cloudflare Access 验证的人员身份；Access policy 决定人员范围。
- `/api/automation/*` 只接受配置入口上的 Bearer token，不接受人员 JWT。
- 浏览器只调用同源接口，不获得数据库、供应商或内部服务凭据。
- 写操作继续执行同源、正文、并发和所属领域校验。
- 查询失败不能转换为空数组、无数据或成功状态。
- 响应不得包含数据库地址、JWT、Cookie、Secret、供应商原始响应或任意观测正文。
- 缓存、游标、状态枚举、错误码和精确字段由对应子合同及可执行 schema 维护。

- `GET /api/ops/overview`
- `GET /api/ops/chat-conversations`
- `GET /api/ops/chat-conversations/:conversationId`
- `GET /api/ops/requests`
- `GET /api/ops/requests/:requestId`

模型配置：

- `GET /api/ops/model-configs`
- `POST /api/ops/model-configs/llm/models`
- `POST /api/ops/model-configs/reranker/models`
- `POST /api/ops/model-configs/notice_classifier/models`
- `PUT /api/ops/model-configs/:kind`

内部门户凭据：

- `GET /api/ops/internal-portal/credentials`
- `POST /api/ops/internal-portal/credentials`
- `PUT /api/ops/internal-portal/credentials/:credentialId`
- `DELETE /api/ops/internal-portal/credentials/:credentialId`
- `POST /api/ops/internal-portal/credentials/:credentialId/validate`
- `POST /api/ops/internal-portal/credentials/:credentialId/reveal`
- `GET /api/ops/internal-portal/automation-tokens`
- `POST /api/ops/internal-portal/automation-tokens`
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/reveal`
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/revoke`

开发者自动化凭据接口（不经过 Cloudflare Access）：

- `GET /api/automation/internal-portal/credentials`
- `POST /api/automation/internal-portal/credentials`
- `GET /api/automation/internal-portal/credentials/:credentialId`
- `PUT /api/automation/internal-portal/credentials/:credentialId`
- `DELETE /api/automation/internal-portal/credentials/:credentialId`

账号管理：

- `GET /api/ops/email-access-grants`
- `POST /api/ops/email-access-grants`
- `POST /api/ops/email-access-grants/:grantId/:action`
- `GET /api/ops/users`
- `GET /api/ops/users/:userId`
- `POST /api/ops/users/:userId/:action`
- `POST /api/ops/users/:userId/sessions/:sessionId/revoke`
- `GET /api/ops/account-events`

同好群：

- `GET /api/ops/groups/catalog`
- `PUT /api/ops/groups/catalog`

通知维护：

- `GET /api/ops/notices`
- `GET /api/ops/notices/:noticeId`
- `PUT /api/ops/notices/:noticeId/category`
- `POST /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs`
- `GET /api/ops/notices/jobs/:jobName`

班车维护：

- `GET /api/ops/transport/routes`、`POST /api/ops/transport/routes`
- `PATCH`、`DELETE /api/ops/transport/routes/:routeId`
- `GET /api/ops/transport/schedule-periods`、`POST /api/ops/transport/schedule-periods`
- `PATCH`、`DELETE /api/ops/transport/schedule-periods/:scheduleId`
- `GET/PUT /api/ops/transport/schedule-periods/:scheduleId/notices`（通知关联，见
  [通知维护接口](./notices.md)）

健康检查：

- `GET /healthz`
- `GET /readyz`

## 通用规则

### 身份和权限

- `/api/ops/*` 验证 Cloudflare Access JWT 的签发方、受众和签名。
- Cloudflare Access policy 决定人员范围；服务端只接受 `type=app` 且 `sub` 非空的人员应用令牌，
  拒绝 `sub` 为空的服务令牌，不复制人员、组或分接口白名单。
- `/api/ops/*` 接口使用同一人员准入。写接口另外执行同源、正文、并发和领域校验；`/api/automation/*`
  使用配置 origin、Bearer token 和自己的输入/CAS 合同，不接受人员 JWT。
- internal-portal-collection 使用既有 `OPS_WEB_INTERNAL_TOKEN` 调用 Ops Web 内部解析接口；该 token 不向
  浏览器或 automation 客户端暴露。
- 浏览器不持有 PostgreSQL、在线模型配置管理接口或外部平台凭据。

### 响应和错误

- 成功正文为 UTF-8 JSON，并在返回前通过 Zod 校验。
- `/api/ops/overview` 返回
  `Cache-Control: private, max-age=15, stale-if-error=300`。
- 其他 `/api/ops/*` 返回 `Cache-Control: no-store`。
- 查询失败不能转换为空数组、`NO_DATA` 或成功状态。
- 错误正文不得包含数据库地址、JWT、Cookie、Secret 或外部平台凭据。
- 所有页面和接口设置内容安全策略并禁止被其他站点嵌入。

错误使用统一 JSON envelope：

```json
{
  "error": {
    "code": "OPS_INVALID_QUERY",
    "message": "运行记录查询参数无效。"
  }
}
```

## 常见错误

| HTTP | 错误码 | 含义 |
| ---: | --- | --- |
| 400 | `OPS_INVALID_QUERY` | 查询参数或游标无效 |
| 400 | `OPS_INVALID_REQUEST_ID` | 请求 ID 格式无效 |
| 400 | `OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED` | 在线模型配置写入合同无效 |
| 400 | `OPS_INTERNAL_PORTAL_INPUT_INVALID`、`OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED` | 内部门户凭据正文或标识无效 |
| 400 | `OPS_DINING_QUERY_INVALID`、`OPS_DINING_DRAFT_INVALID`、`OPS_DINING_PUBLISH_INVALID`、`OPS_DINING_RESTORE_INVALID`、`OPS_DINING_MENU_INVALID`、`OPS_DINING_REVIEW_INVALID`、`OPS_DINING_REPORT_INVALID`、`OPS_DINING_INVALID` | Dining 查询、正文或内容无效 |
| 400 | `OPS_CAMPUS_GROUPS_REQUEST_INVALID` | 同好群目录正文无效 |
| 401 | `OPS_ACCESS_JWT_MISSING`、`OPS_ACCESS_JWT_INVALID` | 未通过 Access 验证 |
| 403 | `OPS_PROVIDER_CONFIG_CSRF_REJECTED` | 在线模型配置写请求不同源 |
| 403 | `OPS_INTERNAL_PORTAL_CSRF_REJECTED` | 内部门户凭据写请求不同源 |
| 403 | `OPS_ACCOUNT_ADMIN_CSRF_REJECTED`、`OPS_EMAIL_ACCESS_CSRF_REJECTED` | 账号管理写请求不同源 |
| 403 | `OPS_DINING_ORIGIN_INVALID` | Dining 写请求不同源 |
| 404 | `OPS_REQUEST_NOT_FOUND`、`OPS_API_ROUTE_NOT_FOUND`、`OPS_DINING_NOT_FOUND` | 请求、接口或地图版本不存在 |
| 409 | `OPS_INTERNAL_PORTAL_CONFLICT` | 内部门户凭据已被其他操作更新 |
| 409 | `OPS_INTERNAL_PORTAL_NAME_CONFLICT` | 内部门户凭据名称已存在 |
| 409 | `OPS_DINING_CONFLICT` | 草稿、发布或评价操作违反领域校验 |
| 503 | `OPS_ADMISSION_NOT_CONFIGURED` | 访问控制未配置 |
| 503 | `OPS_STATUS_STORE_UNAVAILABLE` | PostgreSQL 读取不可用 |
| 503 | `OPS_PROVIDER_CONFIG_UNAVAILABLE` | Model Config 未配置或不可用 |
| 503 | `OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`、`OPS_INTERNAL_PORTAL_CHECK_FAILED`、`OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE` | 内部门户凭据服务、真实验证或候选池不可用 |
| 400 | `OPS_AUTOMATION_TOKEN_INPUT_INVALID`、`OPS_AUTOMATION_QUERY_INVALID` | 自动化 token 管理输入或机器查询参数无效 |
| 401 | `OPS_AUTOMATION_TOKEN_INVALID` | 机器端点缺少、错误或已撤销 Bearer token |
| 404 | `OPS_AUTOMATION_TOKEN_NOT_FOUND` | 自动化 token 不存在 |
| 503 | `OPS_AUTOMATION_NOT_CONFIGURED` | 自动化 token 管理与机器端点未配置 `OPS_WEB_AUTOMATION_ORIGIN` |
| 503 | `OPS_AUTOMATION_TOKEN_STORE_UNAVAILABLE` | 自动化 token 数据库不可用 |
| 503 | `OPS_ACCOUNT_ADMIN_UNAVAILABLE`、`OPS_EMAIL_ACCESS_UNAVAILABLE` | App API 账号管理接口未配置或不可用 |
| 503 | `OPS_DINING_STORE_UNAVAILABLE` | Dining PostgreSQL 不可用 |
| 503 | `OPS_CAMPUS_GROUPS_UNAVAILABLE` | App API 同好群管理接口未配置或不可用 |
| 503 | `OPS_WEB_NOT_READY` | Ops Web 核心依赖未就绪 |
| 500 | `OPS_API_INTERNAL_ERROR` | 未分类服务端错误 |

## 健康与就绪

`GET /healthz` 只证明 Node 进程可以响应，不访问依赖。

`GET /readyz` 无需操作者身份，只检查 Ops Web 接受核心请求所需的公开 origin、请求状态数据库，
以及非本地环境的 Access 配置。Langfuse、Temporal UI、在线模型配置、Dining 和
自动化机器入口不属于顶层就绪条件；它们在所属接口返回局部状态。

## 相关文档

- [Ops Web 产品需求](../../product/ops-web.md)
- [PostgreSQL 所有权](../../data/postgres-ownership.md)

- [会话只读查询](./chat-conversations.md)：历史会话列表、会话详情，以及从运行或反馈查看消息上下文。
