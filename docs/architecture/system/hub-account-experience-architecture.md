---
doc_type: architecture
status: active
created: 2026-06-02
updated: 2026-06-02
---
# Hub Account Experience Architecture

## 文档边界

本文冻结 `apps/hub-web` 如何承接 Identity Platform 的 browser experience。

它回答的是：

- hub 首页和 account center 应消费什么 product projection
- hub 拥有哪些 browser shell responsibility
- hub 不应拥有哪些 auth、identity、access 或 federation truth

本文不定义 app-api canonical identity schema，不定义 Better Auth runtime config，
也不定义 `muc.wiki` MediaWiki 侧 account linking。

## Current Shape

当前 hub 已拥有：

- `/` launcher shell
- `/account`
- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`
- same-site allowlisted app-api seams for `/api/me` and selected `/api/auth/*`

当前 launcher 主入口保持三项：

- 问答助手
- 文档站
- MUC Wiki

这三个 entry 是 hub 顶层产品入口，不表示 hub 拥有对应 app 的内部 router 或
backend truth。

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

Target hub account pages should consume `apps/app-api` product projections,
starting with:

- `GET /api/me/overview` for the account shell and session/federation summary
- `GET /api/me/identity` for the identity section
- `GET /api/me/access` for the access and app availability section
- `GET /api/me/preferences` and `PATCH /api/me/preferences` for preference
  read/write state

The hub UI should not call Better Auth internals directly for account overview
state. Better Auth client calls
remain acceptable for auth actions such as sign-in, sign-up, password reset and
sign-out.

## Signed-In Continuity

Launcher signed-in continuity should be lightweight:

- unauthenticated users see login/register entry points
- authenticated users see account summary and app availability
- restricted or operator surfaces are not exposed as homepage cards
- app entries remain governed by launcher registry target kind and product
  availability

The launcher may show whether an app requires login, but app availability comes
from `app-api` identity/access projection, not from hub-local policy duplication.

## Hub Ownership

Hub owns:

- browser route shell for hub-owned routes
- account center UI composition
- auth form UX
- return target validation for browser navigation
- launcher registry presentation

Hub does not own:

- auth database
- session storage
- principal mapping
- verified identity truth
- authorization truth
- profile memory durable truth
- federation client registry
- MediaWiki account mapping

## MediaWiki Boundary

The MUC Wiki launcher entry remains an external service entry to
`https://muc.wiki`.

Hub must not:

- serve `/wiki` as an internal route
- proxy MediaWiki page/content/upload traffic
- read MediaWiki session or user tables
- present MediaWiki login federation as already enabled before the federation
  contract is implemented

Future `muc.wiki` login belongs to the federation architecture, not to the hub
launcher registry.

## Related Documents

- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `apps/hub-web/README.md`
