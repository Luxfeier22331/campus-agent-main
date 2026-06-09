---
doc_type: contract
status: active
created: 2026-06-02
updated: 2026-06-02
---
# App API Identity Platform HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 campus account center 与 first-party browser surfaces 的
Identity Platform product projection contract。

本文不替代 `docs/contracts/app-api-http.md` 的 shared app-api endpoint inventory，也不冻结
Better Auth internal `/api/auth/*` provider details。

## Cross-Cutting Rules

- All endpoints require a resolved end-user session principal unless explicitly
  stated otherwise.
- Responses use `Cache-Control: no-store`.
- Payloads use `camelCase`.
- Error envelopes follow `docs/contracts/app-api-error-model.md`.
- Projections must not expose raw cookies, raw JWTs, raw Better Auth records,
  password hashes, reset tokens, captcha tokens or provider-specific risk
  signals.
- `profileMemory` and `preferences` are personalization inputs only; they do not
  grant authorization.

## Endpoint Summary

Implemented endpoints:

- `GET /api/me/overview`
- `GET /api/me/identity`
- `GET /api/me/access`
- `GET /api/me/preferences`
- `PATCH /api/me/preferences`

No endpoint in this document may be advertised as implemented until route code,
route exposure inventory and tests exist.

Current route exposure source:

- `apps/app-api/src/app/route-exposure.ts`
- `apps/app-api/src/app/routes/identity-platform.ts`

## `GET /api/me/overview`

Returns the account center overview for the current signed-in principal.

### Overview Response

```json
{
  "account": {
    "accountId": "acct_01HQ...",
    "email": "name@muc.edu.cn",
    "displayName": "Name",
    "status": "active"
  },
  "session": {
    "state": "authenticated",
    "sessionId": "sess_01HQ...",
    "expiresAt": "2026-07-01T12:00:00.000Z",
    "credentialRuntime": "better_auth"
  },
  "identity": {
    "principalId": "user_01HQ...",
    "principalType": "campus_member",
    "verificationStatus": "unverified",
    "claimsVersion": "identity-claims-v1"
  },
  "access": {
    "availableApps": ["chat", "docs", "account"],
    "permissions": {
      "chat": true,
      "operator": false
    },
    "entitlementGroups": ["campus_members"],
    "restrictedSurfacesReady": false
  },
  "preferences": {
    "profileMemoryEnabled": true,
    "profileMemoryItemCount": 0
  },
  "federation": {
    "enabled": false,
    "connectedClients": []
  }
}
```

### Account Object

Fields:

- `accountId`: stable app-owned account id
- `email`: primary email address
- `displayName`: user-facing display name
- `status`: `active`, `suspended`, `deleted`, or `pending_recovery`

Rules:

- `accountId` may be derived from current Better Auth user id, but this contract
  does not expose Better Auth internal table shape.
- `status` is account lifecycle state, not current session state.

### Session Object

Fields:

- `state`: currently `authenticated`
- `sessionId`: current app session id
- `expiresAt`: ISO timestamp
- `credentialRuntime`: implementation summary such as `better_auth`

Rules:

- Raw session token, cookie value and provider adapter payload are never
  returned.
- Unauthenticated callers receive the standard session-required error instead of
  an overview with `state=unauthenticated`.

### Identity Object

Fields:

- `principalId`
- `principalType`
- `verificationStatus`: `unverified`, `verified`, `expired`, or `manual_review`
- `claimsVersion`
- optional `campusAttributes` object when verified claims exist

Rules:

- Better Auth sign-in alone does not imply `verificationStatus=verified`.
- Campus attributes must come from accepted identity sources, directory sync or
  entitlement snapshot.

### Access Object

Fields:

- `availableApps`
- `permissions`
- `entitlementGroups`
- `restrictedSurfacesReady`

Rules:

- `availableApps` is a product projection for campus/app surfaces. It is not a
  replacement for route-level authorization.
- `entitlementGroups` is a compact projection, not canonical authorization store
  export.
- Operator access must remain separated from end-user account product flows.

### Preferences Object

Fields:

- `profileMemoryEnabled`
- `profileMemoryItemCount`

Rules:

- Profile memory values are not returned by overview. The detailed profile
  memory API remains `/api/me/profile-memory`.
- `profileMemoryItemCount` is a summary count only. It must not expose item
  keys, values, confidence or visibility.
- Preferences never grant permissions.

### Federation Object

Fields:

- `enabled`
- `connectedClients`

Rules:

- When this overview endpoint is implemented before federation runtime,
  `enabled=false` is the expected value.
- `connectedClients` must only include app-owned user-facing summaries. It must
  not expose client secrets, raw tokens or authorization codes.

## `GET /api/me/identity`

Returns the current signed-in end-user identity projection.

### Identity Response

```json
{
  "identity": {
    "principalId": "user_01HQ...",
    "principalType": "campus_member",
    "verificationStatus": "unverified",
    "claimsVersion": "identity-claims-v1",
    "campusAttributes": {
      "departments": ["computer_science"],
      "cohort": "2026",
      "major": "software_engineering",
      "program": "undergraduate"
    }
  }
}
```

Rules:

- Only end-user principals may call this endpoint.
- Operator and service principals fail closed with the same end-user-only
  account-center boundary as `/api/me/overview`.
- Better Auth sign-in alone does not imply verified campus identity.
- `campusAttributes` may be omitted when no accepted campus identity attributes
  exist.

## `GET /api/me/access`

Returns the current signed-in end-user access projection for account center and
campus app availability display.

### Access Response

```json
{
  "access": {
    "availableApps": ["chat", "docs", "account"],
    "permissions": {
      "chat": true,
      "operator": false
    },
    "entitlementGroups": ["campus_members"],
    "restrictedSurfacesReady": false
  }
}
```

Rules:

- Only end-user principals may call this endpoint.
- The response is a product projection for browser display and downstream
  admission context. It is not a route authorization bypass.
- `permissions.operator` must not turn an end-user account-center request into
  an operator product flow.
- Preferences and profile memory cannot grant access.

## `GET /api/me/preferences`

Returns the current signed-in end-user account-center preferences projection.

### Preferences Response

```json
{
  "preferences": {
    "profileMemoryEnabled": true,
    "profileMemoryItemCount": 0
  }
}
```

Rules:

- Only end-user principals may call this endpoint.
- The response returns summary preference state only. It must not include raw
  profile memory item keys, values, confidence, visibility or source metadata.
- The current durable profile memory truth remains `profile.memory_settings` and
  `profile.memory_items`.

## `PATCH /api/me/preferences`

Updates mutable account-center preferences for the current signed-in end-user.

### Request

```json
{
  "profileMemoryEnabled": false
}
```

### Preferences Update Response

```json
{
  "preferences": {
    "profileMemoryEnabled": false,
    "profileMemoryItemCount": 0
  }
}
```

Rules:

- `profileMemoryEnabled` is required and must be a boolean.
- The mutation writes the profile memory setting and materializes the current
  app-owned account, identity profile, access snapshot and preference setting
  projection under `identity.*`.
- The mutation must not write Better Auth adapter tables or expose Better Auth
  session internals.
- Preferences remain personalization state. They cannot grant permissions,
  entitlement groups, restricted access or federation claims.

## Related Documents

- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/data/identity-platform-schema.md`
- `docs/contracts/app-api-http.md`
