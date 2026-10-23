---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 用户管理接口

## 边界

浏览器只调用 Ops Web 同源 `/api/ops/*` 接口。Ops Web 使用 Cloudflare Access 已验证的
`operatorId` 作为操作者标识，通过固定的 App API 地址和 `OPS_WEB_INTERNAL_TOKEN` 调用专用管理
接口，不直连 Better Auth 数据库。

所有响应使用 `Cache-Control: no-store`。写操作要求同源请求、`application/json` 和不超过 200
字符的 `Idempotency-Key`；原因字段去除首尾空白后必须为 1 至 500 个字符。同一次操作因网络、
超时或服务临时失败而重试时必须复用原键，参数变化或明确重新发起时使用新键。

## 用户

- `GET /api/ops/users` 按用户 ID、姓名或邮箱、账号状态和游标查询用户；每页最多 100 条；
- `GET /api/ops/users/:userId` 返回账号、邮箱验证、封禁、强制改密、有效 session、只读账号注销状态
  和最近管理记录；
- `GET /api/ops/account-events` 按时间范围、操作者、操作、结果、目标用户和游标查询全局账号操作
记录；
- `POST /api/ops/users/:userId/password-reset-email` 发送密码重置邮件；
- `POST /api/ops/users/:userId/verification-email` 向未验证邮箱发送验证邮件；
- `POST /api/ops/users/:userId/ban` 和 `/unban` 封禁或恢复账号；
- `POST /api/ops/users/:userId/sessions-revoke-all` 撤销全部 session 和 OAuth 凭据；
- `POST /api/ops/users/:userId/sessions/:sessionId/revoke` 撤销指定 session；
- `POST /api/ops/users/:userId/temporary-password` 签发临时密码。

账号状态为 `active`、`unverified`、`password_change_required`、`banned` 或 `deleting`。它们是页面
根据 Better Auth 字段和注销任务生成的互斥显示状态，不写入单独的账号状态字段。

用户 ID 使用精确匹配；包含 `@` 的完整邮箱使用忽略大小写的精确匹配；其他关键词使用忽略
大小写的姓名或邮箱前缀匹配。接口不提供任意位置的子串搜索，也不返回全量用户数。

管理记录结果为 `started`、`succeeded`、`failed` 或 `indeterminate`。业务操作完成后无法
确认最终审计写入，且记录超过五分钟仍为 `started` 时，App API 将其改为 `indeterminate`；
页面显示“结果未确认”，不得推断业务操作成功或失败。

临时密码只在首次成功响应中出现，页面只保存在当前 React 内存状态，关闭后不能重新读取。同一
幂等键重放不会再次返回密码。页面不得把密码写入日志、浏览器存储或查询缓存。

用户列表和全局操作记录的筛选、游标与返回地址保存在经过校验的路由查询参数中，页面刷新、复制
地址或从用户详情返回时不能丢失当前查询位置。

## 账号注销状态

用户详情在存在注销任务时显示申请、最近尝试、下次尝试、完成、更新时间、尝试次数和最近错误码。
该区域只读。注销由 Campus Web 用户发起，App API 后台状态机按自己的重试规则推进，并在个人记忆
和关联数据清理完成后删除认证账号。Ops Web 不提供全局注销队列、人工重试、跳过清理、直接删除
或恢复登录入口。

## 禁止能力

本接口不提供模拟登录、创建用户、任意资料修改、手工验证邮箱、角色修改、直接删除用户、人工推进
注销或恢复正在注销的账号。完整地址邀请和测试授权由 [账号准入接口](./access.md) 负责。

跨应用可执行合同由 `campus-contracts/account-admin` 维护，并生成
`packages/contracts/schemas/account-admin.v1.schema.json`。通用身份、错误和安全规则见
[Ops Web 接口](./README.md)。

账号操作记录使用[统一时间范围](./runtime.md#时间范围)，默认今日，按操作发生时间采用
`[from, to)` 过滤；自选日期最多90天，响应 `filters` 返回实际查询边界。
