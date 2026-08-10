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

开发者自动化程序使用环境配置的机器端点（`OPS_WEB_AUTOMATION_ORIGIN`），调用
`/api/automation/internal-portal/credentials*`。该端点不挂 Cloudflare Access application；每次请求
必须提供 `Authorization: Bearer <automation-token>`，且请求 Host 必须与配置 origin 的 host（包含显式
端口）一致。配置 origin 是页面显示的规范外部地址；代理终止 TLS 后转发给 Node 的内部协议不参与
入口判断。机器端点不提供 token 创建、reveal、检查或名称修改能力，也不读取 Source Collector。

人工 `/api/ops/*` 写请求必须通过同源校验，包含正文时使用 `application/json`。机器端点不使用浏览器
Origin 或 CSRF，而是固定检查配置 origin 的 Host、Bearer token 和请求合同。所有响应使用
`Cache-Control: no-store`。

自动化 origin 是局部机器能力的入口配置，不参与 `/readyz` 的核心依赖判定。缺少或格式非法时，人工
页面的凭据管理仍可使用，但自动化 token 管理区和机器端点返回
`503 OPS_AUTOMATION_NOT_CONFIGURED`；生产环境不提供固定测试 token。

## 接口

- `GET /api/ops/internal-portal/credentials` 返回全部记录的标识、名称、版本、创建与更新时间、最近
  尝试、最近成功和结果分类，不返回 TGC；
- `POST /api/ops/internal-portal/credentials` 接收 `name` 与 `ssoTgc` 候选输入，真实验证成功后创建记录；
- `PUT /api/ops/internal-portal/credentials/:credentialId` 接收且只接收 `name` 或 `ssoTgc`。修改要求
  `If-Match: "<version>"`；轮换候选必须先通过真实验证；
- `DELETE /api/ops/internal-portal/credentials/:credentialId` 要求当前 `If-Match` 并删除记录；
- `POST /api/ops/internal-portal/credentials/:credentialId/validate` 立即检查当前值并返回更新后的
  metadata；认证失败记录为结果，不删除记录；
- `POST /api/ops/internal-portal/credentials/:credentialId/reveal` 返回当前原始 `ssoTgc`、标识和版本。

人工端点还提供自动化 token 管理，所有请求仍需 Cloudflare Access；写请求要求同源和 JSON：

- `GET /api/ops/internal-portal/automation-tokens` 返回端点 origin 和 token metadata；
- `POST /api/ops/internal-portal/automation-tokens` 以 `name` 创建 token，并返回明文；
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/reveal` 按 ID 重复返回明文；
- `POST /api/ops/internal-portal/automation-tokens/:tokenId/revoke` 撤销 token。

机器端点只提供以下能力：

- `POST /api/automation/internal-portal/credentials` 接收严格的 `{ "name": "...", "ssoTgc": "..." }`，
  在名称不存在时完成真实验证并创建一条具名凭据；名称已存在时返回 `409`；
- `GET /api/automation/internal-portal/credentials` 返回所有凭据 metadata；
- `GET /api/automation/internal-portal/credentials/:credentialId` 返回单条 metadata，并以
  `ETag: "<version>"` 返回当前版本；
- `PUT /api/automation/internal-portal/credentials/:credentialId` 只接收严格的
  `{ "ssoTgc": "..." }`，要求 `If-Match: "<version>"`，并复用真实 CAS 验证和轮换逻辑；
- `DELETE /api/automation/internal-portal/credentials/:credentialId` 要求当前
  `If-Match: "<version>"` 后删除记录。

提取器模板把一个稳定的凭据名称映射到一条记录：第一次成功运行使用 `POST` 创建，后续运行使用当前版本的
`PUT` 轮换。轮换不等待旧 TGC 过期；候选值在真实验证失败时不得覆盖旧值。名称冲突只表示并发首次创建已经有
另一条记录，调用方应重新读取 metadata 后按版本轮换。

机器端点的成功和错误响应均为 `Cache-Control: no-store`。Bearer 缺失、格式错误、未知或已撤销
token 返回 `401 OPS_AUTOMATION_TOKEN_INVALID`；端点未配置返回 `503 OPS_AUTOMATION_NOT_CONFIGURED`；
查询参数或正文不符合合同返回 `400`；版本冲突继续返回 `409 OPS_INTERNAL_PORTAL_CONFLICT`。

名称去除首尾空白后为 1 至 80 个字符，且在凭据表中唯一。候选输入最多 16 KiB，可以是原始 ASCII TGC 值、
`SSO_TGC=<value>` Cookie 对，或包含唯一一个 `SSO_TGC` 的完整请求 Cookie；Cookie 名称不区分
大小写，解析不执行 URL 解码。完整 Cookie 中的 `Path`、`JSESSIONID`、`nginx` 和重复非目标字段
不会持久化。缺失、空值、重复 `SSO_TGC` 或无法解析的输入返回
`400 OPS_INTERNAL_PORTAL_INPUT_INVALID`。请求正文上限为 20 KiB。记录标识为 UUID，版本为正整数。结果分类为 `valid`、
`credential_rejected` 或 `check_failed`。

新增和轮换在数据库写入前完成真实 CAS 验证。验证失败不得创建记录或覆盖原值。CAS 返回刷新的
TGC 时保存刷新值。`If-Match` 缺失返回 `428 OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED`，记录版本
变化返回 `409 OPS_INTERNAL_PORTAL_CONFLICT`。

## 明文生命周期

TGC 不出现在列表、ETag、URL、错误正文或日志。reveal 必须使用 `POST`，响应不缓存。页面只把返回
值写入当前对话框 state；关闭对话框后清除，不写 TanStack Query cache、mutation variables、
mutation result、浏览器存储或剪贴板以外的持久位置。复制只能由操作者显式触发。

自动化 token 是独立的多条具名记录。为支持在 Ops Web 中重复查看，数据库保存 token 明文和用于
认证查询的 SHA-256 hash；普通列表只返回 metadata，明文只通过人工 `POST .../reveal` 或创建响应
返回。撤销只阻止后续 Bearer 认证，不删除记录或改变历史 metadata。一个有效 token 默认可管理全部
具名内部门户凭据，不按环境、人员或用途再拆权限状态。

## 失败语义

- `422 OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED`：候选 TGC 被 CAS 或门户拒绝；
- `400 OPS_INTERNAL_PORTAL_INPUT_INVALID`：候选值或 Cookie 格式无效；
- `503 OPS_INTERNAL_PORTAL_CHECK_FAILED`：候选验证因网络、超时或依赖错误未完成；
- `404 OPS_INTERNAL_PORTAL_NOT_FOUND`：记录不存在；
- `409 OPS_INTERNAL_PORTAL_CONFLICT`：调用方版本已过期；
- `409 OPS_INTERNAL_PORTAL_NAME_CONFLICT`：凭据名称已被另一条记录使用；
- `503 OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE`：PostgreSQL 读取或写入不可用。

定时检查语义和人工操作步骤见 `../../runbooks/portal-auth.md`，数据结构所有权见
`../../data/internal-portal.md`。
