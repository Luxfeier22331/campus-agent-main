---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 内部门户凭据接口

## 边界

浏览器只调用 Ops Web 同源 `/api/ops/internal-portal/credentials*`。Cloudflare Access 决定可访问
人员，Ops Web Node 后端拥有 PostgreSQL 明文持久化和真实 CAS 验证。接口不提供用户名或密码登录、
主凭据选择、自动切换、采集触发或 Kubernetes Secret 管理。

除读取列表外的请求必须为同源请求；包含正文时使用 `application/json`。所有响应使用
`Cache-Control: no-store`。

## 接口

- `GET /api/ops/internal-portal/credentials` 返回全部记录的标识、名称、版本、创建与更新时间、最近
  尝试、最近成功和结果分类，不返回 TGC；
- `POST /api/ops/internal-portal/credentials` 接收 `name` 与原始 `ssoTgc`，真实验证成功后创建记录；
- `PUT /api/ops/internal-portal/credentials/:credentialId` 接收且只接收 `name` 或 `ssoTgc`。修改要求
  `If-Match: "<version>"`；轮换候选必须先通过真实验证；
- `DELETE /api/ops/internal-portal/credentials/:credentialId` 要求当前 `If-Match` 并删除记录；
- `POST /api/ops/internal-portal/credentials/:credentialId/validate` 立即检查当前值并返回更新后的
  metadata；认证失败记录为结果，不删除记录；
- `POST /api/ops/internal-portal/credentials/:credentialId/reveal` 返回当前原始 `ssoTgc`、标识和版本。

名称去除首尾空白后为 1 至 80 个字符。TGC 最多 16 KiB，只接受不带 `SSO_TGC=` 前缀的原始 ASCII
Cookie 值；请求正文上限为 20 KiB。记录标识为 UUID，版本为正整数。结果分类为 `valid`、
`credential_rejected` 或 `check_failed`。

新增和轮换在数据库写入前完成真实 CAS 验证。验证失败不得创建记录或覆盖原值。CAS 返回刷新的
TGC 时保存刷新值。`If-Match` 缺失返回 `428 OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED`，记录版本
变化返回 `409 OPS_INTERNAL_PORTAL_CONFLICT`。

## 明文生命周期

TGC 不出现在列表、ETag、URL、错误正文或日志。reveal 必须使用 `POST`，响应不缓存。页面只把返回
值写入当前对话框 state；关闭对话框后清除，不写 TanStack Query cache、mutation variables、
mutation result、浏览器存储或剪贴板以外的持久位置。复制只能由操作者显式触发。

## 失败语义

- `422 OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED`：候选 TGC 被 CAS 或门户拒绝；
- `503 OPS_INTERNAL_PORTAL_CHECK_FAILED`：候选验证因网络、超时或依赖错误未完成；
- `404 OPS_INTERNAL_PORTAL_NOT_FOUND`：记录不存在；
- `409 OPS_INTERNAL_PORTAL_CONFLICT`：调用方版本已过期；
- `503 OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`：PostgreSQL 读取或写入不可用。

定时检查语义和人工操作步骤见 `../../runbooks/portal-auth.md`，数据结构所有权见
`../../data/internal-portal.md`。
