---
doc_type: architecture
status: active
created: 2026-06-02
updated: 2026-06-02
---
# Federation And MUC Wiki Login Architecture

## 文档边界

本文冻结 future `muc.wiki` login federation 的 target architecture。

它回答的是：

- Identity Platform 如何作为 provider
- `muc.wiki` 如何作为 relying party
- 为什么不采用 cookie/session/database compatibility
- Better Auth provider plugins 在架构中的位置

本文不表示 `muc.wiki` login federation 已经上线，也不要求本轮实现 provider endpoints。

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

Login federation should use OIDC first.

OAuth 2.1 provider support is useful as protocol substrate, but login
integration needs OIDC-level semantics:

- issuer
- subject
- ID token
- userinfo
- JWKS
- scopes and claims
- relying-party client policy
- end-session semantics

## Provider Runtime

Better Auth `oauthProvider` / `oidcProvider` plugins are accepted candidate
runtime adapters, not canonical architecture owners.

Before implementation, the workstream must verify:

- Worker compatibility
- Drizzle schema generation and migration ownership
- static controlled client registry posture
- redirect URI validation
- custom claims mapping
- consent / trusted-client handling
- end-session behavior
- key rotation and JWKS exposure

If Better Auth provider plugins satisfy the contract, prefer them over
hand-written protocol implementation.

## Public Origin And Routing

The public issuer may be `https://hub.muc.wiki`, because hub is the app-set
entry surface. That does not make hub the provider owner.

If the public origin is hub-owned, hub may expose only explicit allowlisted
federation seams, such as OIDC discovery and `/api/federation/*`, to
`apps/app-api`. It must not become a generic app-api proxy or a MediaWiki
compatibility backend.

## Client Registry

首期 federation client registry 固定为 controlled/static posture。

Required client semantics:

- client id
- client type: confidential or public
- redirect URI allowlist
- post-logout redirect URI allowlist
- allowed scopes
- claims policy id
- consent policy
- enabled / disabled state

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
https://hub.muc.wiki/claims/principal_type
https://hub.muc.wiki/claims/identity_status
```

Authorization-sensitive details such as raw entitlement snapshots, profile
memory, operator flags and internal service claims must not be emitted to generic
relying parties.

## Consent And Trusted Clients

For first-party or institution-controlled clients, such as `muc.wiki`, a
trusted-client policy may skip repeated consent only after the client is
explicitly registered and documented.

Skipping consent must be a property of the federation client policy, not a
hard-coded behavior inside hub UI or MediaWiki integration code.

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

## Forbidden Shapes

- Do not share `.muc.wiki` auth cookies across hub/app surfaces and MediaWiki.
- Do not import MediaWiki password hashes or sessions into app-api.
- Do not let MediaWiki database rows become app-api account truth.
- Do not use profile memory or chat history in federation claims.
- Do not expose operator or service principal claims to `muc.wiki` unless
  explicitly modeled as a separate administrative federation client.
- Do not write provider endpoints as one-off MediaWiki compatibility routes
  outside Identity Platform.

## Related Documents

- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/contracts/app-api-federation-http.md`
- `docs/data/identity-platform-schema.md`
