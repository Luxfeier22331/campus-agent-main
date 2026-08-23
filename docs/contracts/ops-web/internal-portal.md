---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 内部门户凭据接口

## 边界

Ops Web 直接提供人员页面、开发者 automation endpoint 和内部解析接口，并保存 TGC、检查结果与
`internal_portal.credentials`。凭据管理与门户验证在 Ops Web 内完成；采集 Job 使用既有
`OPS_WEB_INTERNAL_TOKEN` 调用内部解析接口。

浏览器只调用同源 `/api/ops/internal-portal/credentials*`。Cloudflare Access 决定人员准入；写请求还
要求同源、严格 JSON 和当前 `If-Match`。机器端点使用 `OPS_WEB_AUTOMATION_ORIGIN` 的 Host 与
automation Bearer token，不使用人员 JWT。所有响应为 `Cache-Control: no-store`。

## 人工管理

- `GET /api/ops/internal-portal/credentials`：列出 metadata，不返回 TGC；
- `POST /api/ops/internal-portal/credentials`：验证后创建 `{ name, ssoTgc }`；
- `PUT /api/ops/internal-portal/credentials/:credentialId`：按当前 `If-Match` 重命名或轮换；
- `DELETE /api/ops/internal-portal/credentials/:credentialId`：按当前 `If-Match` 删除；
- `POST /api/ops/internal-portal/credentials/:credentialId/validate`：立即检查当前值；
- `POST /api/ops/internal-portal/credentials/:credentialId/reveal`：返回当前 TGC 与版本。

Ops Web 将本地领域结果映射为现有 `OPS_INTERNAL_PORTAL_*` 错误码。凭据数据库或门户验证依赖不可用时，
管理 API 返回对应的 `503` 错误；内部解析失败也保留有界的 `503` 语义。

## 自动化管理

人员端点管理 automation token：

- `GET /api/ops/internal-portal/automation-tokens`
- `POST /api/ops/internal-portal/automation-tokens`
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/reveal`
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/revoke`

机器端点管理凭据：

- `GET|POST /api/automation/internal-portal/credentials`
- `GET|PUT|DELETE /api/automation/internal-portal/credentials/:credentialId`

机器端点不提供 reveal、人工检查或重命名。更新和删除要求 `If-Match: "<version>"`。automation token
缺失、未知或已撤销时返回 `401 OPS_AUTOMATION_TOKEN_INVALID`；端点未配置时返回
`503 OPS_AUTOMATION_NOT_CONFIGURED`。

## 输入与并发

名称去除首尾空白后为 1 至 80 个字符且唯一。候选输入最多 16 KiB，可以是裸 TGC、
`SSO_TGC=<value>`，或包含唯一 `SSO_TGC` 的 Cookie；不保存其他 Cookie。新增和轮换必须先通过真实
CAS 验证，失败不能覆盖旧值。CAS 返回刷新值时 Ops Web 保存新值并更新版本。

## 明文生命周期

TGC 不出现在列表、URL、ETag、错误正文或日志。人工 reveal 只写入当前对话框 state。采集消费者不
读取数据库；它们使用 `OPS_WEB_INTERNAL_URL` 和共享 token 调用 Ops Web 的
`POST /internal/ops/internal-portal/credentials/resolve`。响应以
`campus-contracts/internal-portal-credential` 为准。

## 错误

- `400 OPS_INTERNAL_PORTAL_INPUT_INVALID`
- `422 OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED`
- `503 OPS_INTERNAL_PORTAL_CHECK_FAILED`
- `404 OPS_INTERNAL_PORTAL_NOT_FOUND`
- `409 OPS_INTERNAL_PORTAL_CONFLICT`
- `409 OPS_INTERNAL_PORTAL_NAME_CONFLICT`
- `503 OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`
- `428 OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED`

数据所有权见 `../../data/internal-portal.md`，操作步骤见 `../../runbooks/portal-auth.md`。
