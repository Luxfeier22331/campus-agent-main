---
doc_type: architecture
owner_boundary: apps/app-api
status: active
---

# MUC Wiki 联邦登录架构

## 边界

本文定义 app-api Identity Platform 与 `muc.wiki` relying party 的 OIDC-compatible 关系。实际
部署状态由环境和 `../../runbooks/federation.md` 验证，不从本文推断。

## 关系

```text
browser
-> MediaWiki OpenID Connect / PluggableAuth
-> app-api federation endpoints
-> app-owned account / identity / access
-> Better Auth provider adapter
```

app-api 拥有 issuer、client 和 claim policy；MediaWiki 拥有 Wiki 本地 account linking、group 和
permission。

## 协议与 Adapter

使用 OAuth 2.1/OIDC-compatible authorization code + PKCE：

- issuer、subject、ID token、userinfo 和 JWKS；
- scope/claim policy；
- 受控客户端注册表；
- end-session。

runtime adapter 使用 `@better-auth/oauth-provider` 和 Better Auth `jwt()`。禁止在仓库自写 OAuth
协议栈。native `/oauth2/*` 与 `/jwks` 只作为内部映射，public endpoint 使用 well-known 和
`/api/federation/*`。

public issuer 为 `https://campus.muc.wiki`；campus-web 只代理明确 allowlist 的 federation
route，不成为 provider owner 或 generic app-api proxy。

## 客户端

首个 controlled client 为 `muc-wiki`：

- confidential，`client_secret_basic`；
- `authorization_code` 和 `refresh_token`；
- response type `code`；
- scope `openid profile email`；
- PKCE `S256`；
- 受信任第一方同意策略；
- redirect/post-logout URI 精确 allowlist；
- dynamic registration 关闭。

client 由 app-api provision script 写入 Better Auth OAuth table，并由 app-owned runtime policy
约束，不由
浏览器、MediaWiki 或 provider admin UI 创建。

## 身份声明

默认只发布 `sub`、`email`、`email_verified`、`name`、`preferred_username` 和
`updated_at`。campus claim 必须使用命名空间并由 client policy 显式允许。

raw entitlement、profile memory、chat history、operator flag 和 service principal material 不得
发给普通 relying party。

## 账号关联

首次登录由 MediaWiki extension 按稳定 subject/email 建立 Wiki 本地映射。Wiki 权限继续由
MediaWiki 判断；app-api 不导入 user、password hash、session、group 或 page permission。

## 禁止形态

- 跨 campus/Wiki 共享 auth Cookie；
- 导入 MediaWiki password/session；
- profile memory 或聊天历史进入 claim；
- 向普通 Wiki client 暴露 operator/service claim；
- 在 Identity Platform 外增加专用 Wiki federation endpoint。

## 相关文档

- `identity-authz.md`
- `../../contracts/app-api/federation.md`
- `../../contracts/app-api/auth.md`
- `../../runbooks/federation.md`
