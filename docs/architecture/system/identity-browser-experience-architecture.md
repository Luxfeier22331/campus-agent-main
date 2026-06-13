---
doc_type: architecture
truth_scope: product
owner_boundary: apps/campus-web
status: active
created: 2026-06-02
updated: 2026-06-09
---
# Identity Browser Experience Architecture

## 文档边界

本文冻结 browser account experience 如何承接 Identity Platform。

它回答的是：

- `campus-web` account center 应消费什么 product projection
- `campus-web` 拥有哪些 account browser shell responsibility
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
- `/account/federation/consent`
- `/account/federation/error`
- same-origin allowlisted app-api seams for `/api/me/*`, selected `/api/auth/*`
  and implemented `/api/federation/*`

## Target Account Center IA

目标 account center 固定为 Identity Platform projection consumer。

Recommended route shape:

- `/account`
  - account overview
- `/account/identity`
  - campus identity and verification state
- `/account/access`
  - available apps, permissions and entitlement summary
- `/account/preferences`
  - profile memory and user preferences
- `/account/security`
  - password, sessions and sign-out actions

Existing auth action routes remain:

- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`

Implementation may stage these pages, but the IA must not collapse
identity/access/preferences into a raw session object.

## Product Projection

Target account pages should consume `apps/app-api` product projections,
starting with:

- `GET /api/me/overview` for the account shell and session/federation summary
- `GET /api/me/identity` for the identity section
- `GET /api/me/access` for the access and app availability section
- `GET /api/me/preferences` and `PATCH /api/me/preferences` for preference
  read/write state

The browser shell should not call Better Auth internals directly for account
overview state. Better Auth client calls
remain acceptable for auth actions such as sign-in, sign-up, password reset and
sign-out.

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
- account center UI composition
- auth form UX
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
