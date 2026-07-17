---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Federation HTTP 合同

## 边界

app-api Identity Platform 使用 Better Auth OAuth Provider + `jwt()` 作为 OIDC-compatible runtime
adapter。public contract 固定在 well-known 和 `/api/federation/*`；native `/oauth2/*` 与
`/jwks` 只是内部映射。

首期只允许 controlled/static client，不开放动态注册。Better Auth runtime state 位于
`app_auth.*`，client/claim policy 由 app-api federation runtime 校验。

## 发现

- `GET /.well-known/openid-configuration`
- `GET /.well-known/oauth-authorization-server`

metadata 至少包含 issuer、authorization/token/userinfo/JWKS/end-session endpoint，以及支持的
response type、grant type、scope、claim 和 signing algorithm。

production issuer 为 `https://campus.muc.wiki`，staging 使用部署环境 issuer。metadata host
必须与当前部署 origin 一致，不能把 staging origin 写成 production。

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

redirect URI 必须精确匹配 registry。endpoint 要求 active app-api session。trusted-client consent
skip 只能来自 client policy，caller 不能自行指定。

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
- provider logout 不删除 MediaWiki 本地 account linking；
- app-api session revoke 与 relying-party local logout 是不同操作。

## 首个 Client

`muc-wiki` 为 confidential trusted first-party client：

- auth method `client_secret_basic`；
- grant `authorization_code`、`refresh_token`；
- response type `code`；
- scope `openid profile email`；
- PKCE required；
- end-session enabled；
- redirect 和 post-logout URI 精确 allowlist。

secret 只进入部署 secret store。配置步骤见 `../../runbooks/federation.md`。

## 可执行来源

- `apps/app-api/src/app/routes/federation.ts`
- `apps/app-api/src/modules/auth/auth.ts`
- `apps/app-api/ops/identity/`

## 相关文档

- `../../architecture/system/mucwiki-login.md`
- `../../architecture/system/identity-authz.md`
- `./auth.md`
