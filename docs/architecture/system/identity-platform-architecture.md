---
doc_type: architecture
status: active
created: 2026-06-02
updated: 2026-06-02
---
# Identity Platform Architecture

## 文档边界

本文冻结 MUC Wiki Hub Identity Platform 的 supporting architecture。

它回答的是：

- 用户系统的长期分层是什么
- `apps/app-api`、Better Auth、hub、execution path 与 future `muc.wiki` federation
  各自拥有什么
- 哪些事实是 canonical product truth，哪些只是 runtime adapter state

本文不替代：

- `docs/architecture/system/identity-and-authorization-architecture.md`
  - 负责 authorization、memory 与 retrieval filter projection
- `docs/contracts/app-api-identity-platform-http.md`
  - 负责 browser-facing identity projection wire shape
- `docs/data/identity-platform-schema.md`
  - 负责 logical schema ownership
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
  - 负责 future relying-party federation

## Core Principle

长期用户系统不围绕 auth library 建模。

固定分层为：

```text
browser surfaces / muc.wiki relying party
-> app-api Identity Platform product projections / federation protocol
-> app-owned account / identity / access / preferences / federation policy
-> auth runtime adapter
-> Better Auth or another credential/session/provider implementation
```

当前 Better Auth runtime 可以继续工作，但它处在 adapter 层。它不定义产品账号模型、
校园身份模型、access entitlement 模型或 external federation policy。

## Ownership

### `apps/app-api`

`apps/app-api` 拥有 Identity Platform canonical product truth：

- account lifecycle
- principal mapping
- verified identity status and claims version
- access / entitlement projection
- profile memory / preferences control surface
- federation client registry and claims policy
- minimal actor/context/authz projection toward execution

### auth runtime adapter

auth runtime adapter 负责 credential/session/provider mechanics：

- email/password sign-in and sign-up
- password reset
- session cookie and server-side session lookup
- CSRF / origin / captcha admission
- optional future passkey / social login / OAuth/OIDC provider plugin runtime

Current runtime adapter is Better Auth. Future replacement is allowed only if
Identity Platform product contracts remain stable or are explicitly versioned.

### `apps/hub-web`

`apps/hub-web` owns only browser product experience:

- launcher
- account center shell
- auth forms
- signed-in continuity
- return-target handling

It consumes app-api projections. It does not own identity truth.

### execution / retrieval path

Execution and retrieval consume typed projections only:

- actor/context projection
- authorization projection
- selected profile memory summary, when enabled

They do not read raw auth runtime state, raw cookies, raw Better Auth records,
raw profile memory tables or raw MediaWiki identity state.

### `muc.wiki`

Future `muc.wiki` login integration is a relying-party relationship. MediaWiki
owns wiki-side account linking and local user lifecycle. Identity Platform owns
issuer, client policy and claims.

## Product Model

### Account

Account is the stable app-owned user record.

Minimum semantics:

- stable account id
- primary email
- display name
- account status
- created / updated timestamps

Account status is not the same as current session state.

### Session

Session is runtime state.

Minimum semantics:

- authenticated / unauthenticated state
- session id
- expiry
- credential/runtime source summary

Session may be projected to hub for account overview, but raw session material
never crosses into
supervisor, retrieval or MediaWiki.

### Identity

Identity answers “who is this principal in the institution context?”

Minimum semantics:

- end-user principal type: `campus_member`, `student`, `staff`, or `faculty`
- separate operator/service principal class when the account represents an
  operator bridge or controlled machine actor
- verification status
- claims version
- optional campus attributes such as department, cohort, major or program

Better Auth sign-in alone does not prove verified campus identity. Verified
identity must come from an accepted campus identity source, directory sync or
equivalent entitlement snapshot.

### Access

Access answers “what can this principal use or see?”

Minimum semantics:

- app availability, such as chat/docs/account center
- operator permission
- entitlement groups
- restricted document visibility projection
- ownership / approval summaries for product resources

Access policy is app-owned product truth. Any `access` object exposed to hub,
execution or retrieval is a compact projection of that truth. Profile memory and
preferences cannot grant access.

### Preferences

Preferences answer “how should the product behave for this account?”

Minimum semantics:

- profile memory enabled state
- user-visible profile memory item count or summary
- future UI and notification preferences

Preferences can influence personalization and UX, not authorization.

### Federation

Federation answers “which relying parties may ask Identity Platform to
authenticate a user?”

Minimum semantics:

- issuer
- controlled client registry
- redirect URI policy
- scopes and claims policy
- consent or trusted-client policy
- logout / end-session policy

`muc.wiki` is expected to become a federation client only through this layer.

## Current Implementation Mapping

Current implemented truth:

- `apps/app-api/src/modules/auth/auth.ts` owns Better Auth runtime assembly for
  email/password, session lookup, password reset, Turnstile admission, origin
  and CSRF posture.
- `apps/app-api/src/modules/auth/principal.ts` maps Better Auth session material
  and trusted operator/internal inputs into typed `ResolvedAppPrincipal`, actor
  context and authorization projection.
- `apps/app-api/src/app/routes/auth.ts` exposes current `ALL /api/auth/*` and
  compact `GET /api/me` runtime principal projection.
- `apps/app-api/src/db/schema/identity.ts` defines the current app-owned
  `identity.*` physical schema for account, identity profile, access snapshot,
  preference and federation policy materialization.
- `apps/app-api/src/app/routes/identity-platform.ts` implements
  `GET /api/me/overview`, `GET /api/me/preferences` and
  `PATCH /api/me/preferences` as the current account-center product projection
  surface.
- `apps/app-api/src/modules/identity-platform/service.ts` builds the overview
  from the resolved end-user principal, authorization projection and profile
  memory summary. It rejects operator/service principals and does not expose raw
  Better Auth rows, cookies, tokens or profile memory item values.
- `apps/app-api/src/modules/identity-platform/store.ts` owns the current
  Identity Platform write path. Scoped preference mutation updates
  `profile.memory_settings` and materializes `identity.accounts`,
  `identity.identity_profiles`, `identity.preference_settings` and
  `identity.access_snapshots` together.
- `apps/hub-web/src/index.ts` allowlists `/api/me`, `/api/me/overview`,
  `/api/me/preferences` and selected `/api/auth/*` seams to `apps/app-api`; it
  does not expose `/api/federation/*` yet.
- `apps/hub-web/src/routes/app-router.tsx` currently owns `/`, `/account` and
  auth action routes. The account page consumes `/api/me/overview` rather than
  Better Auth raw payload.
- `apps/app-api/src/db/schema/profile.ts` and `docs/data/app-api-schema.md`
  currently own profile memory durable truth under `profile.*`.

Forward contracts not yet implemented:

- scoped `/api/me/identity` and `/api/me/access` endpoints.
- OAuth/OIDC provider routes, discovery metadata, JWKS and federation client
  runtime. Current Better Auth documentation describes the OAuth Provider plugin
  as an OAuth 2.1 provider with OIDC compatibility, discovery metadata and JWKS
  verification support; implementation must verify Worker compatibility,
  schema generation, client registration policy and claims mapping before
  enabling federation routes.

## Forbidden Shapes

- Do not expose Better Auth raw tables or provider payload as account center
  product contract.
- Do not let hub become the auth database, session store, principal mapper or
  generic app-api proxy.
- Do not use profile memory, preferences, chat history or retrieval evidence as
  authorization truth.
- Do not integrate `muc.wiki` login through shared cookies, database import,
  MediaWiki session reuse or one-off compatibility endpoints outside Identity
  Platform.

## Related Documents

- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/hub-account-experience-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `docs/data/identity-platform-schema.md`
