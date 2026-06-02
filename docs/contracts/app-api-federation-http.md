---
doc_type: contract
status: active
created: 2026-06-02
updated: 2026-06-02
---
# App API Federation HTTP Contract

## 文档边界

本文冻结 Identity Platform future OIDC/OAuth provider surface 的 target HTTP
contract。

本文是 forward contract：它不表示当前 routes 已经实现，也不表示 `muc.wiki` 已经接入。

## Provider Posture

Provider owner: `apps/app-api` Identity Platform.

Runtime substrate: Better Auth `oauthProvider` / `oidcProvider` plugins may be
used if implementation review confirms Worker compatibility, schema ownership
and claims policy support.

Client posture: controlled/static client registry for first implementation.
Open dynamic client registration is out of scope.

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
- PKCE is required for public clients and allowed for confidential clients.
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

First implementation must use controlled/static client registration.

Minimum client fields:

- `clientId`
- `clientType`
- `clientName`
- `redirectUris`
- `postLogoutRedirectUris`
- `allowedScopes`
- `claimsPolicyId`
- `consentPolicy`
- `enabled`

Client secret values must be stored as secret material, not in docs or committed
config.

## Related Documents

- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/data/identity-platform-schema.md`
