---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0045
status: accepted
created: 2026-06-02
updated: 2026-06-09
---
# ADR-0045 Identity Platform And Auth Runtime Boundary

## 状态

Accepted on 2026-06-02.

## 背景

`campus-agent` 已经具备可工作的 end-user auth 基础：`apps/app-api` 使用
Better Auth 承接 email/password、session、password reset、Turnstile 与
same-origin browser auth endpoints；`apps/campus-web` 已承接 `/account/*` account
browser shell。

这组实现能工作，但不能直接被提升为长期用户系统架构中心。如果继续围绕当前
Better Auth config 与 `/api/me` runtime projection 扩展，后续会产生几类债务：

- auth library 的 user/session/account shape 会反向定义产品账号模型
- account center 会围绕底层 session object 编写，而不是消费稳定 product
  projection
- 校园身份、access entitlement、profile memory 与 federation client policy 容易混在
  一层
- future `muc.wiki` login federation 容易退化成 cookie/session/database 兼容，而不是
  标准 relying-party 协议

因此这里冻结用户系统的长期分层：`apps/app-api` 拥有 MUC Wiki Identity
Platform；Better Auth 只是当前 auth runtime adapter，不是 canonical user system。

## 决策

### 决策 1：`apps/app-api` 拥有 MUC Wiki Identity Platform

长期用户系统 owner 固定为 `apps/app-api`。

Identity Platform 至少覆盖：

- account core
- credential / session runtime adapter
- verified identity profile
- access / entitlement
- preferences / profile memory control
- federation client and claims policy

`apps/campus-web`、legacy `apps/public-chat-web`、`apps/operator-console-web`、
historical supervisor API app、agent、retrieval 与 MediaWiki 都不得拥有 canonical app
identity truth。已删除的 `apps/public-docs` 也不得重新成为 identity browser surface owner。

### 决策 2：Better Auth 是 auth runtime adapter，不是产品账号模型

Better Auth 当前可以继续承担：

- email/password credential flow
- session cookie and server-side session runtime
- password reset
- Turnstile / auth admission plugins
- future OAuth/OIDC provider runtime, if accepted after capability review

但 Better Auth 的 internal `user` / `session` / `account` / plugin tables 不得成为
产品账号中心、校园身份、access entitlement 或 federation policy 的 canonical schema。

直接含义：

- browser surfaces 不直接围绕 Better Auth raw payload 建模
- product contract 不暴露 Better Auth internal table shape
- future auth runtime replacement 不应要求重写 account center 或 supervisor actor
  projection

### 决策 3：账号产品模型固定拆成五层

Identity Platform 的 product model 固定拆成：

- `account`：账号本体、邮箱、显示名、状态与生命周期
- `identity`：校园身份、验证状态、principal class 与 claims version
- `access`：surface/app availability、permissions、entitlement 与 operator/service
  边界
- `preferences`：用户偏好、profile memory 控制与 personalization setting
- `federation`：external client、OIDC/OAuth claims、consent、logout 与 relying-party
  policy

`session` 是 runtime state；它可以出现在 account overview projection 中，但不替代
account、identity 或 access truth。

### 决策 4：campus-web 只消费 Identity Platform projection

`apps/campus-web` 的 account center 和 signed-in continuity 只消费 `apps/app-api` 暴露的
forward product projection，例如 `/api/me/overview`。

campus-web 不拥有：

- auth database
- session storage
- principal mapping
- authorization truth
- federation client registry
- MediaWiki account mapping

campus-web 可以拥有：

- `/account/*` browser shell
- account center UI
- auth form UX
- return-target handling

### 决策 5：`muc.wiki` future login federation 只走显式协议

既有 `muc.wiki` MediaWiki 继续作为 sibling service 运营。

future login federation 的长期形态固定为：

- `apps/app-api` / Identity Platform 作为 OIDC/OAuth provider owner
- `muc.wiki` 作为 relying party / client
- MediaWiki 侧负责 local wiki account linking 与 wiki-specific user lifecycle

明确不做：

- 不共享 `.muc.wiki` cookie
- 不导入 MediaWiki user table、password hash 或 session
- 不让 MediaWiki session 成为 app identity truth
- 不让 campus-web 代理 MediaWiki page/content/upload/account state

### 决策 6：OIDC 优先于裸 OAuth 作为登录 federation 协议

当目标是“登录到 `muc.wiki`”时，首选 OIDC。OAuth 2.1 provider 能力可以作为底层
授权协议组成部分，但 repo-level login federation contract 必须表达 issuer、subject、
userinfo、JWKS、claims 与 relying-party policy。

首期 federation client posture 固定为 controlled/static client registry，不开放
public dynamic client registration。

### 决策 7：profile memory 与 preferences 不得授权

Profile memory、UI preferences 与 personalization hints 只允许影响：

- launcher/account UX
- query wording / disambiguation
- retrieval planning hints
- answer wording

它们不得扩大 visibility、serving surface、approval、tool permission 或 restricted document
entitlement。

## 结果

直接结果如下：

- 新增 `docs/architecture/system/identity-platform-architecture.md` 作为用户系统主架构文档
- 新增 `docs/contracts/app-api-identity-platform-http.md` 作为 account center 的
  product projection contract
- 新增 `docs/data/identity-platform-schema.md` 区分 Better Auth-owned runtime tables
  与 app-owned identity product schema
- 新增 `docs/architecture/system/federation-and-mucwiki-login-architecture.md` 与
  `docs/contracts/app-api-federation-http.md` 冻结 future `muc.wiki` federation 边界
- `docs/architecture/system/identity-and-authorization-architecture.md` 继续负责
  authz / memory / retrieval filter projection，不再承担完整 account product model

明确不做：

- 不在本 ADR 中实现 OAuth/OIDC provider
- 不承诺当前 `muc.wiki` 已接入新登录
- 不推翻当前可工作的 Better Auth email/password runtime
- 不把 Better Auth provider 插件能力写成已启用 runtime truth

## 相关文档

- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `docs/contracts/app-api-federation-http.md`
- `docs/data/identity-platform-schema.md`
