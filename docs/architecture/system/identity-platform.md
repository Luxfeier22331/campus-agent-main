---
doc_type: architecture
owner_boundary: apps/app-api
status: active
---

# 身份平台

## 边界

用户系统围绕产品 account、identity、access、preference 和 federation 建模，不围绕具体 auth
library 建模。

```text
browser / relying party
-> app-api Identity Platform projection / federation protocol
-> app-owned product truth
-> auth runtime adapter
-> Better Auth credential/session/provider implementation
```

Better Auth 是当前 adapter，不拥有产品账号、校园身份、entitlement 或 relying-party policy。

## 所有权

### app-api

- 账号生命周期和主体映射；
- 已验证身份和声明版本；
- 访问与权限投影；
- 偏好与个人记忆控制界面；
- 联邦客户端、声明策略和用户授权；
- 向 execution 提供最小 actor/authz projection。

### 认证适配器

- 邮箱密码、重置、session Cookie 和服务端查询；
- CSRF、来源和验证码准入；
- OAuth/OIDC 供应商运行时；
- 适配器自有表及签名与 JWKS。

替换 adapter 时，Identity Platform 产品合同必须保持稳定或显式版本化。

### campus-web

只拥有浏览器体验和 route composition，消费 app-api projection，不拥有 identity truth。

### execution/retrieval

只消费 typed actor、authz 和可选 bounded memory context；不读取 raw Cookie、JWT、auth row、
profile table 或 MediaWiki state。

### muc.wiki

作为 relying party 管理 Wiki 本地 account linking 和权限。Identity Platform 管理 issuer、
client policy 和 claims。

## 产品模型

- **Account**：稳定 account ID、主邮箱、display name 和 lifecycle status；
- **Session**：认证状态、session ID、到期时间和 credential runtime 摘要；
- **Identity**：principal type、verification status、claims version 和受控 campus attribute；
- **Access**：可用应用、permission、entitlement group 和 restricted-surface posture；
- **Preferences**：profile-memory 开关及明确建模的 UI/通知偏好；
- **Federation**：issuer、client registry、redirect allowlist、scope/claim、consent 和 logout policy。

登录成功不等于校园身份已验证。Preference 和 memory 只能影响体验，不能授予 access。

## 当前实现入口

- auth assembly：`apps/app-api/src/modules/auth/auth.ts`；
- principal mapping：`apps/app-api/src/modules/auth/principal.ts`；
- identity schema：`apps/app-api/src/db/schema/identity.ts`；
- auth adapter schema：`apps/app-api/src/db/schema/auth.ts`；
- identity routes：`apps/app-api/src/app/routes/identity-platform.ts`；
- federation routes：`apps/app-api/src/app/routes/federation.ts`；
- 受控客户端配置：`apps/app-api/ops/identity/`。

当前 account-center projection 包括 overview、identity、access、preferences、session management 和
authorized apps。registration/session lifecycle materialize app-owned identity rows，但不会把 raw
Better Auth/profile rows 批量复制为产品 truth。

Federation 使用 `@better-auth/oauth-provider` 和 Better Auth `jwt()`，public contract 固定在
well-known 与 `/api/federation/*`；native `/oauth2/*` 和 `/jwks` 是内部映射目标。

## 禁止形态

- 将 Better Auth raw table/provider payload 暴露为账号合同；
- campus-web 成为 auth DB、session store、principal mapper 或 generic app-api proxy；
- memory、preference、chat history 或 retrieval evidence 参与授权；
- 通过共享 Cookie、数据库导入或 MediaWiki session 复用实现联邦；
- 在 Identity Platform 外增加一次性 provider endpoint。

## 相关文档

- `identity-authz.md`
- `identity-browser.md`
- `mucwiki-login.md`
- `../../contracts/app-api/identity.md`
- `../../data/identity-platform.md`
