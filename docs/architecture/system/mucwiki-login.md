---
doc_type: architecture
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-02
updated: 2026-06-09
---
# Federation And MUC Wiki Login Architecture

## 文档边界

本文冻结 `muc.wiki` login federation 的 target architecture 与当前 provider
implementation truth。

它回答的是：

- Identity Platform 如何作为 provider
- `muc.wiki` 如何作为 relying party
- 为什么不采用 cookie/session/database compatibility
- Better Auth provider runtime 在架构中的位置

本文表示 `apps/app-api` 的 federation provider endpoints 已实现；它不表示
`muc.wiki` production login federation 已经上线。上线前仍必须完成
`nc-arm-6c` 上的 MediaWiki staging smoke、client secret 注入与 client provision。

## Target Relationship

长期关系固定为：

```text
user browser
-> muc.wiki MediaWiki login extension
-> app-api Identity Platform federation endpoints
-> app-api account / identity / access truth
-> auth runtime adapter
```

`apps/app-api` owns provider truth. `muc.wiki` owns wiki-local account linking
and wiki permissions.

## Protocol Choice

Login federation uses an OIDC-compatible login surface. The selected runtime
adapter is Better Auth OAuth Provider rather than the older Better Auth OIDC
Provider plugin.

The required semantics remain OIDC-level:

- issuer
- subject
- ID token
- userinfo
- JWKS
- scopes and claims
- relying-party client policy
- end-session semantics

## Provider Runtime

Better Auth provider plugins are accepted runtime adapters, not canonical
architecture owners.

Current provider selection:

- Use `@better-auth/oauth-provider` for OAuth 2.1 provider behavior with
  OIDC-compatible discovery, userinfo, ID token and end-session semantics.
- Use Better Auth `jwt()` as the signing / JWKS substrate.
- Do not make Better Auth OIDC Provider the production default while official
  documentation marks it as active-development/deprecation-bound.

Current implementation readiness:

- `apps/app-api/src/modules/auth/auth.ts` mounts `jwt()` and
  `oauthProvider()`.
- Dynamic client registration is disabled.
- `cachedTrustedClients` admits only `muc-wiki`.
- Better Auth's ordinary `/token` endpoint is disabled so it cannot conflict
  with OAuth `/oauth2/token`.
- Better Auth native `/oauth2/*` and `/jwks` endpoints are internal mapping
  targets behind the canonical public `/api/federation/*` routes.
- Better Auth runtime tables live in `app_auth.*`.
- App-owned federation policy remains in `identity.federation_*`.
- The first client is materialized by the app-api provision script, not by
  browser UI, MediaWiki or a provider admin UI.

Do not write a hand-made OAuth/OIDC protocol stack in this repo.

## Public Origin And Routing

The public issuer is `https://campus.muc.wiki`, because campus-web is the
student-facing product endpoint and account browser shell. That does not make
campus-web the provider owner.

Campus-web exposes only explicit allowlisted federation seams, namely discovery
routes and canonical `/api/federation/*`, to `apps/app-api`. It must not become
a generic app-api proxy or a MediaWiki compatibility backend.

## Client Registry

首期 federation client registry 固定为 controlled/static posture。

The first client is `muc-wiki`:

- client type: confidential
- token endpoint auth: `client_secret_basic`
- allowed scopes: `openid`, `profile`, `email`
- response type: `code`
- grant types: `authorization_code`, `refresh_token`
- PKCE: required with `S256`
- consent policy: `trusted_first_party_skip_repeated_consent`
- end-session: enabled
- redirect URI allowlist: the full MediaWiki `Special:PluggableAuthLogin`
  callback URL
- post-logout redirect URI allowlist: explicit wiki logout/return URL

Dynamic public client registration is out of scope for the first implementation.

## Claims Policy

Default OIDC claims should be minimal:

- `sub`
- `email`
- `email_verified`
- `name`
- `preferred_username`
- `updated_at`

Campus-specific claims must be namespaced and must not expose internal
authorization store objects.

Example namespace:

```text
https://campus.muc.wiki/claims/principal_type
https://campus.muc.wiki/claims/identity_status
```

Authorization-sensitive details such as raw entitlement snapshots, profile
memory, operator flags and internal service claims must not be emitted to generic
relying parties.

## Consent And Trusted Clients

For first-party or institution-controlled clients, such as `muc.wiki`, a
trusted-client policy may skip repeated consent only after the client is
explicitly registered and documented.

Skipping consent must be a property of the federation client policy, not a
hard-coded behavior inside browser UI or MediaWiki integration code.

## Account Linking

MediaWiki owns wiki-side account linking.

Identity Platform provides stable subject and claims. It does not import
MediaWiki users, password hashes, session rows, group memberships or page
permissions.

Recommended posture:

- first login maps OIDC subject/email to a wiki-local account according to
  MediaWiki extension policy
- wiki-local permissions continue to be evaluated by MediaWiki
- app-api does not become MediaWiki permission authority

Staging setup uses MediaWiki `OpenID Connect` extension plus
`PluggableAuth`. Provider URL is `https://campus-staging.mucwiki-edge.link` for
staging and `https://campus.muc.wiki` for production. The client secret is
runtime secret material and is never committed.

## Forbidden Shapes

- Do not share `.muc.wiki` auth cookies across campus/app surfaces and MediaWiki.
- Do not import MediaWiki password hashes or sessions into app-api.
- Do not let MediaWiki database rows become app-api account truth.
- Do not use profile memory or chat history in federation claims.
- Do not expose operator or service principal claims to `muc.wiki` unless
  explicitly modeled as a separate administrative federation client.
- Do not write provider endpoints as one-off MediaWiki compatibility routes
  outside Identity Platform.

## Related Documents

- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-platform.md`
- `docs/contracts/app-api/federation.md`
- `docs/data/identity-platform.md`
