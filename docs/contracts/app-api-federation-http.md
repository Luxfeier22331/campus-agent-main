---
doc_type: contract
status: active
created: 2026-06-02
updated: 2026-06-03
---
# App API Federation HTTP Contract

## 文档边界

本文冻结 Identity Platform OAuth/OIDC-compatible provider surface 的 HTTP
contract。

本文描述当前已实现的 provider route surface。它不表示 `muc.wiki` production
login federation 已经 rollout；production 前仍必须完成 staging client provision
和 `nc-arm-6c` MediaWiki OpenID Connect smoke。

## Provider Posture

Provider owner: `apps/app-api` Identity Platform.

Runtime substrate: Better Auth OAuth Provider is the selected runtime adapter
for the OIDC-compatible login surface. Better Auth OIDC Provider must not be
treated as the production default while official documentation marks it as
active-development/deprecation-bound.

Current implementation: `apps/app-api` mounts `@better-auth/oauth-provider` as
the selected provider runtime adapter and Better Auth `jwt()` as the signing /
JWKS substrate. The auth runtime disables the ordinary Better Auth `/token`
endpoint and disables JWT header emission so OAuth `/oauth2/token` and
`/oauth2/userinfo` remain the only federation token/userinfo semantics.

`apps/app-api` exposes canonical public routes under `/api/federation/*` and
well-known discovery routes. Better Auth native `/oauth2/*` and `/jwks` paths
are internal mapping targets, not the public contract.

Client posture: controlled/static client registry for first implementation.
Open dynamic client registration is out of scope.

Runtime persistence:

- Better Auth-owned runtime state lives in `app_auth.oauthClient`,
  `app_auth.oauthRefreshToken`, `app_auth.oauthAccessToken`,
  `app_auth.oauthConsent` and `app_auth.jwks`.
- App-owned product policy lives in `identity.federation_clients`,
  `identity.federation_claims_policies` and
  `identity.federation_user_grants`.
- The `muc-wiki` client is materialized by
  `pnpm --dir apps/app-api federation:provision-muc-wiki` or
  `pnpm --dir apps/app-api federation:provision-muc-wiki:staging`, not by Hub
  UI or MediaWiki.

## Discovery

### `GET /.well-known/openid-configuration`

Returns provider metadata for OIDC clients.

Required fields include:

```json
{
  "issuer": "https://hub.muc.wiki",
  "authorization_endpoint": "https://hub.muc.wiki/api/federation/authorize",
  "token_endpoint": "https://hub.muc.wiki/api/federation/token",
  "userinfo_endpoint": "https://hub.muc.wiki/api/federation/userinfo",
  "jwks_uri": "https://hub.muc.wiki/api/federation/jwks",
  "end_session_endpoint": "https://hub.muc.wiki/api/federation/logout",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": [
    "sub",
    "email",
    "email_verified",
    "name",
    "preferred_username",
    "updated_at"
  ]
}
```

The final issuer and endpoint host must match deployed Identity Platform
origin. Local/staging origins must not be documented as production truth.

Production issuer:

```text
https://hub.muc.wiki
```

Staging issuer:

```text
https://hub-staging.mucwiki-edge.link
```

If the issuer is `https://hub.muc.wiki`, hub only exposes explicit allowlisted
federation seams to `apps/app-api`. Endpoint ownership remains in `apps/app-api`.

## Authorization Endpoint

### `GET /api/federation/authorize`

Accepts OIDC authorization code requests.

Required request parameters:

- `client_id`
- `redirect_uri`
- `response_type=code`
- `scope`
- `state`
- `nonce`
- `code_challenge`
- `code_challenge_method=S256`

Rules:

- `redirect_uri` must match client registry exactly.
- The first `muc-wiki` confidential client requires PKCE by client policy.
- The endpoint requires an active app-api session principal.
- Trusted-client consent skipping must come from client policy, not caller
  input.

## Token Endpoint

### `POST /api/federation/token`

Exchanges authorization code for tokens.

Supported grant types:

- `authorization_code`
- `refresh_token`, only if explicitly enabled for the client

Rules:

- confidential clients must authenticate according to registered token endpoint
  auth method
- public clients must use PKCE
- access tokens and refresh tokens are never logged or returned through hub
  account overview

## Userinfo Endpoint

### `GET /api/federation/userinfo`

Returns claims allowed by client policy and granted scopes.

Default claim set:

```json
{
  "sub": "acct_01HQ...",
  "email": "name@muc.edu.cn",
  "email_verified": true,
  "name": "Name",
  "preferred_username": "name",
  "updated_at": 1798790400
}
```

Rules:

- `sub` must be stable for the issuer and client policy.
- profile memory, chat history, raw entitlement snapshots, operator secrets and
  service principal material are never emitted.
- campus claims must be namespaced and separately allowed by claims policy.

## JWKS Endpoint

### `GET /api/federation/jwks`

Returns public signing keys.

Rules:

- private signing keys must never be stored in repo or returned by any browser
  endpoint
- key rotation must preserve validation of unexpired issued tokens

## End Session Endpoint

### `GET /api/federation/logout`

Supports relying-party logout / end-session semantics when implemented by the
provider runtime.

Rules:

- provider logout must not silently mutate MediaWiki-local account linking
- post-logout redirect must match client registry
- app-api session revocation and relying-party local logout are separate
  operations

## Client Registry

First implementation uses controlled/static client registration.

The first client is:

- `clientId`: `muc-wiki`
- `clientType`: `confidential`
- `clientName`: `MUC Wiki`
- `allowedScopes`: `["openid", "profile", "email"]`
- `claimsPolicyId`: `muc-wiki-default`
- `consentPolicy`: `trusted_first_party_skip_repeated_consent`
- `enabled`: `true`
- `tokenEndpointAuthMethod`: `client_secret_basic`
- `grantTypes`: `["authorization_code", "refresh_token"]`
- `responseTypes`: `["code"]`
- `requirePKCE`: `true`
- `enableEndSession`: `true`

Client secret values must be stored as secret material, not in docs or committed
config.

Staging provision command:

```bash
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:UserLogout' \
pnpm --dir apps/app-api federation:provision-muc-wiki:staging
```

## Related Documents

- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/data/identity-platform-schema.md`
