---
doc_type: architecture
truth_scope: product
owner_boundary: apps/campus-web
status: active
created: 2026-06-02
updated: 2026-06-22
---
# Identity Browser Experience Architecture

## 文档边界

本文冻结 browser account experience 如何承接 Identity Platform。

它回答的是：

- `campus-web` account center 应消费什么 product projection
- `campus-web` 拥有哪些 account browser shell responsibility
- account browser UI 哪些部分由 Better Auth UI / shadcn 组件承接
- browser shell 不应拥有哪些 auth、identity、access 或 federation truth

本文不定义 app-api canonical identity schema，不定义 Better Auth runtime config，
也不定义 `muc.wiki` MediaWiki 侧 account linking。

## Current Shape

当前 `campus-web` 拥有：

- `/` student campus experience shell
- `/account`
- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`
- `/account/settings/account`
- `/account/settings/security`
- `/account/federation/consent`
- `/account/federation/error`
- same-origin allowlisted app-api seams for `/api/me/*`, selected `/api/auth/*`
  and implemented `/api/federation/*`

Account browser UI 当前形态：

- `/account/login`、`/account/register`、`/account/forgot-password` 和
  `/account/reset-password` 由 `better-auth-ui` 的 `AuthView` 承接
- `/account`、`/account/settings/account` 和 `/account/settings/security` 由
  `better-auth-ui` 的 `AccountView` 承接
- Q&A 顶栏账号入口由 `better-auth-ui` 的 `UserButton` 承接
- `campus-web` 只保留 route composition、中文文案、Turnstile runtime config、
  return target，以及通过 Better Auth UI required field 注入的注册协议确认
- 账号 surface 的通用按钮、卡片、勾选框与弹层 primitive 通过 shadcn/Radix
  wrappers 承接；`campus-web` 不再维护第二套账号表单、登录弹窗或账号设置产品组件

## Target Account Center IA

目标 account center 固定为 auth runtime UI + Identity Platform projection
consumer 的组合，而不是 `campus-web` 自研账号产品组件。

Current route shape:

- `/account`
  - account settings landing
- `/account/settings/account`
  - account profile settings
- `/account/settings/security`
  - password and session security settings

Existing auth action routes remain:

- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`

If the product later needs campus identity, access or preferences views, those
sections must be added as separate product projection pages. They must not be
implemented by expanding Better Auth UI raw session payloads, and they must not
reintroduce a second self-built auth/settings UI.

## Product Projection

Campus identity/access/preferences product pages, when implemented, consume
`apps/app-api` product projections:

- `GET /api/me/overview` for the account shell and session/federation summary
- `GET /api/me/identity` for the identity section
- `GET /api/me/access` for the access and app availability section
- `GET /api/me/preferences` and `PATCH /api/me/preferences` for preference
  read/write state

Auth/settings UI may call Better Auth client APIs through `better-auth-ui` for
auth runtime actions such as sign-in, sign-up, password reset, sign-out,
password change and session management. Product identity/access/preference truth
still belongs to `apps/app-api` projections.

## Signed-In Continuity

Student surface signed-in continuity should be lightweight:

- unauthenticated users see login/register entry points
- authenticated users see account summary and app availability
- restricted or operator surfaces are not exposed as homepage cards
- app entries remain governed by `campus-web` information architecture and
  product availability

Account availability comes from `app-api` identity/access projection, not from
browser-shell-local policy duplication.

## Browser Shell Ownership

`campus-web` owns:

- browser route shell for campus/account routes
- account route composition
- Better Auth UI provider wiring, localization and non-persistent registration
  legal consent field wiring
- return target validation for browser navigation
- campus app grid/navigation presentation

`campus-web` does not own:

- auth database
- session storage
- principal mapping
- verified identity truth
- authorization truth
- profile memory durable truth
- federation client registry
- MediaWiki account mapping
- long-lived consent ledger or audit log for registration legal acceptance

## MediaWiki Boundary

The MUC Wiki content site remains a sibling service at `https://muc.wiki`.

`campus-web` must not:

- serve `/wiki` as an internal route
- proxy MediaWiki page/content/upload traffic
- read MediaWiki session or user tables
- present MediaWiki login federation as already enabled before the federation
  contract is implemented

`muc.wiki` login belongs to the federation architecture and `apps/app-api`
provider truth, not to the browser shell.

## Related Documents

- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `apps/campus-web/README.md`
