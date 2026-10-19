---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Federation HTTP 合同

## 边界

App API 使用 Better Auth OAuth Provider + `jwt()` 提供 OAuth 2.0 / OpenID Connect Provider。
公开合同固定在 well-known 和 `/api/federation/*`；native `/oauth2/*` 与 `/jwks` 只是内部映射。

只允许受控静态 client，不开放动态注册。Better Auth runtime state 位于 `app_auth.*`，client、
redirect URI、scope 和 claim policy 由 App API 所有。当前仓库不提供面向任意调用方的 client
注册或 provisioning 接口。

## 发现

- `GET /.well-known/openid-configuration`
- `GET /.well-known/oauth-authorization-server`

metadata 至少包含 issuer、authorization/token/userinfo/JWKS/end-session endpoint，以及支持的
response type、grant type、scope、claim 和 signing algorithm。

部署环境共用 `https://chat.muc.wiki`，每个泳道有固定 issuer，不随默认泳道变化：

| 泳道 | issuer | 服务端 endpoint（token / userinfo / JWKS） | 浏览器 endpoint（authorize / end-session） |
| --- | --- | --- | --- |
| production | `https://chat.muc.wiki` | `/api/federation/*` | `/api/federation/*?lane=prod` |
| staging | `https://chat.muc.wiki/lanes/staging` | `/lanes/staging/api/federation/*` | `/api/federation/*?lane=staging` |

- discovery 位于 `<issuer>/.well-known/openid-configuration`；RFC 8414 metadata 同时接受
  `<issuer>/.well-known/oauth-authorization-server` 与
  `/.well-known/oauth-authorization-server<issuer path>`。id_token `iss` 等于泳道 issuer。
- 服务端 endpoint 不依赖 Cookie，由 edge router 按 issuer 路径选择泳道；不带前缀的路径只属于
  production，production 未部署时返回 `dependency_not_ready`。
- 浏览器 endpoint 的 `?lane=` 在授权前把用户切到签发泳道，登录与 consent 页面随泳道 Cookie
  留在同一泳道；因此登录其他泳道的 relying party 会改变用户当前泳道。
- development 与 test 不设泳道，issuer 为 `AUTH_SHELL_ORIGIN`，endpoint 不带泳道参数。

## 授权

`GET /api/federation/authorize` 接受 authorization code request：

- `client_id`
- `redirect_uri`
- `response_type=code`
- `scope`
- `state`
- `nonce`
- `code_challenge`
- `code_challenge_method=S256`

redirect URI 必须精确匹配 registry。无会话时 Provider 跳转到 Campus Web 登录页；需要同意时跳转到
Campus Web consent 页面。调用方不能自行指定跳过同意。

## Consent 页面支持

### Client 展示信息

`GET /api/federation/client?client_id=<id>` 要求有效用户会话，并映射到 Provider 的
`/oauth2/public-client`。响应只允许以下公开展示字段：

- `client_id`
- `client_name`
- `client_uri`
- `logo_uri`
- `contacts`
- `tos_uri`
- `policy_uri`

client secret、redirect allowlist、grant policy、私有 metadata 和 owner 引用不得进入响应。client
不存在或禁用时，Campus Web 不允许用户确认授权。

### 同意决定

`POST /api/federation/consent` 接受：

```json
{
  "accept": true,
  "oauth_query": "<provider-signed-query>"
}
```

`oauth_query` 必须保留 Provider 重定向页面中由重复 `ba_param` 指定的完整签名参数，包括 `sig`、
`exp` 和 `ba_iat`。Campus Web 不重建 OAuth 参数，也不自行判定签名；Provider 校验签名和过期时间。
篡改、缺失或过期的查询必须失败。

Provider 返回 `{ "redirect": true, "url": "..." }`。该响应保持 JSON，由 Campus Web 在允许
同源 URL 或 HTTPS URL 后执行导航；App API 不把 consent POST 自动改写为跨域 HTTP redirect。

## Token 交换

`POST /api/federation/token` 支持 `authorization_code`，以及 client 明确允许时的
`refresh_token`。

confidential client 按 registry 的 auth method 认证，public client 必须使用 PKCE。access/refresh
token 不记录日志，也不进入 browser account overview。

## 用户信息

`GET /api/federation/userinfo` 只返回 scope 与 claim policy 允许的字段：

- `sub`
- `email`
- `email_verified`
- `name`
- `preferred_username`
- `updated_at`

`sub` 对 issuer/client policy 稳定。profile memory、chat history、raw entitlement、operator
secret 和 service principal material 始终禁止；campus claim 必须使用命名空间。

## JWKS

`GET /api/federation/jwks` 只返回 public signing key。private key 不进入仓库或浏览器接口；轮换
必须保证未过期 token 仍可验证。

## 结束会话

`GET /api/federation/logout` 实现 relying-party end-session：

- post-logout redirect 必须匹配 client registry；
- Provider logout 不删除 relying party 的本地账号关联；
- App API session revoke 与 relying party local logout 是不同操作。

## Client 生命周期

client 记录由 App API 的 `app_auth.oauthClient` 所有，注册、修改和停用必须走受控运维变更；不能
通过浏览器或动态注册 endpoint 完成。具体 client 的 secret、redirect URI 和外部系统配置属于对应
接入变更，不写入本通用合同。

## 可执行来源

- `apps/app-api/src/app/routes/federation.ts`
- `apps/edge-router/src/lane.ts`
- `packages/contracts/src/environment-lanes.ts`
- `apps/app-api/src/modules/auth/auth.ts`
- `apps/campus-web/src/app/routes/federation-pages.tsx`
- `apps/campus-web/src/platform/auth/oauth-context.ts`

## 相关文档

- [身份与权限](../../architecture/system/identity-authz.md)
- [App API 登录与当前用户接口](./auth.md)
