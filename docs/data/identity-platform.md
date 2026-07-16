---
doc_type: data
owner_boundary: apps/app-api
status: active
---

# 身份平台数据

## 边界

本文说明 auth adapter table、app-owned identity truth、产品 projection 和 federation policy 的
逻辑所有权。精确字段与索引由 `apps/app-api/src/db/schema/identity.ts`、`auth.ts`、migration
和测试维护。

## Schema 分组

- `app_auth.*`：Better Auth 凭据、session、OAuth 和 JWKS 运行时；
- `identity.accounts`：产品账号生命周期；
- `identity.identity_profiles`：校园身份与声明版本；
- `identity.access_snapshots`：访问与权限投影；
- `identity.preference_settings`：账号级偏好；
- `identity.federation_*`：客户端、声明策略和用户授权。

`identity` 是当前物理 schema 名。改变名称可以另行决策，但 app-owned 与 adapter-owned 分层
不得消失。

## 认证适配器

`app_auth` 包括 user、session、account、verification、OAuth client/token/consent 和 JWKS。

- Better Auth internal column 不是产品 account schema；
- 产品 migration 不直接修改 adapter internal column；
- runtime 可以将 user/session 映射为 app-owned projection；
- HTTP 不暴露 raw row、token 或 credential；
- federation runtime row 不替代 app-owned client/claim policy。

## `identity.accounts`

保存 account ID、primary email、display name、status 和时间。status 允许 `active`、
`suspended`、`deleted`、`pending_recovery`。

account ID 可以暂时与 Better Auth user ID 相同，但合同将其视为 app-owned identity。account
status 不直接决定 restricted content，access 由 entitlement/policy 判断。

## `identity.identity_profiles`

保存 account/principal identity、principal type、verification status、claims version、campus
attribute 和有效期。

end-user principal type 为 `campus_member`、`student`、`staff`、`faculty`；operator 和
service 是独立 runtime principal class，不折叠为普通用户 profile。

verification status 为 `unverified`、`verified`、`expired` 或 `manual_review`。Better Auth
登录本身不能写 verified；campus attribute 必须来自接受的 identity source 或 entitlement
snapshot。

## `identity.access_snapshots`

保存 account/principal、entitlement group、available app、permission、restricted-surface
posture、policy version 和有效期。

snapshot 是有界 projection，不是 policy store。memory/preference 不能修改 entitlement。
execution/retrieval 只消费 projection，不读取 raw policy object。

## `identity.preference_settings`

保存个人记忆开关、显式界面偏好和更新时间。`profile.memory_settings` 与
`profile.memory_items` 保存用户可见的显式个人资料记忆及其产品设置；Hindsight 仍拥有在线
记忆提取、合并和召回。`identity.*` 只保存账号中心需要的读取结果。

偏好只能影响用户体验和个性化，不能授予访问权限或默认改变联邦身份声明。

`profile.memory_items` 只接受受控键和值，不得表达授权、权限或文档可见性。删除项目时必须
通过 execution-control 同步删除对应 Hindsight 文档；关闭个人记忆只停止后续执行使用，
不删除现有项目。

## 联邦身份

### `identity.federation_clients`

保存 controlled client ID/type/name、redirect 和 post-logout allowlist、scope、claim policy、
consent policy 和 enabled 状态。首个 `muc-wiki` client 由 app-api provision script 创建。
client secret 不进入该文档、fixture 或公开 config。

### `identity.federation_claims_policies`

保存 allowed scope/claim 与 campus claim namespace。raw entitlement、memory、chat、operator
secret 和 service principal material 不能成为通用 claim。

### `identity.federation_user_grants`

保存 account/client、granted scope、grant state 和 revoke 时间。grant 不替代 client policy 或
session admission；revoke 也不会自动删除 MediaWiki 本地 account linking。

## 物化

registration 和 account-center lifecycle 可以从 resolved principal materialize app-owned account、
profile、preference 和 access snapshot。scoped preference mutation 同时更新 memory setting 和
identity product projection。

不得把全部 Better Auth row 或 profile memory value 批量复制进 `identity.*`。

## 相关文档

- `../architecture/system/identity-platform.md`
- `../contracts/app-api/identity.md`
- `../contracts/app-api/federation.md`
