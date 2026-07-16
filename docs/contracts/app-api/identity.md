---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Identity Platform HTTP 合同

## 通用规则

- 除明确说明外，接口要求 end-user session principal；
- response 使用 `Cache-Control: no-store` 和 `camelCase`；
- 错误使用 `error.md`；
- 不返回 Cookie、JWT、session token、password hash、reset/captcha token、raw Better Auth row 或
  provider risk signal；
- preference/profile memory 不能授予 access。

## 接口

- `GET /api/me/overview`
- `GET /api/me/identity`
- `GET /api/me/access`
- `GET|PATCH /api/me/preferences`
- `GET /api/me/security/sessions`
- `DELETE /api/me/security/sessions/:sessionId`
- `GET /api/me/authorized-apps`
- `DELETE /api/me/authorized-apps/:clientId`

只有 route、exposure inventory 和测试同时存在时才能声明接口已实现。

## 概览

`GET /api/me/overview` 返回账号中心组合投影：

```ts
type IdentityOverview = {
  account: {
    accountId: string;
    email: string;
    displayName: string;
    status: "active" | "suspended" | "deleted" | "pending_recovery";
  };
  session: {
    state: "authenticated";
    sessionId: string;
    expiresAt: string;
    credentialRuntime: string;
  };
  identity: {
    principalId: string;
    principalType: string;
    verificationStatus: string;
    claimsVersion: string;
  };
  access: AccessProjection;
  preferences: PreferencesProjection;
  federation: {
    enabled: boolean;
    connectedClients: AuthorizedAppSummary[];
  };
};
```

account status 与 session state 分离。raw session、adapter table 和 internal policy object 不进入
response。

## 身份

`GET /api/me/identity` 返回：

```ts
type IdentityProjection = {
  principalId: string;
  principalType: "campus_member" | "student" | "staff" | "faculty";
  verificationStatus: "unverified" | "verified" | "expired" | "manual_review";
  claimsVersion: string;
  campusAttributes: Record<string, string>;
  verifiedAt: string | null;
  expiresAt: string | null;
};
```

登录不自动表示 `verified`。campus attribute 只来自接受的 identity source，不能从邮箱或浏览器
输入猜测。

## 访问权限

`GET /api/me/access` 返回：

```ts
type AccessProjection = {
  availableApps: string[];
  permissions: Record<string, boolean>;
  entitlementGroups: string[];
  restrictedSurfacesReady: boolean;
  policyProjectionVersion: string;
  expiresAt: string | null;
};
```

该对象用于展示和下游准入，不绕过具体 route authorization。`permissions.operator` 也不会把账号
中心请求升级成 operator flow。

## 偏好设置

`GET /api/me/preferences` 返回：

```ts
type PreferencesProjection = {
  profileMemoryEnabled: boolean;
  profileMemoryItemCount: number;
};
```

不返回 memory key/value、confidence、visibility 或 source metadata。

`PATCH /api/me/preferences` 当前请求为：

```json
{ "profileMemoryEnabled": false }
```

字段必须是 boolean。写入 profile memory setting，并 materialize 当前 account、identity、access
和 preference projection；不得修改 Better Auth adapter table。返回更新后的
`PreferencesProjection`。

## 会话

`GET /api/me/security/sessions` 返回：

```ts
type SessionSummary = {
  sessionId: string;
  current: boolean;
  deviceLabel: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
};
```

来源为 `app_auth.session`，但不返回 token、Cookie、raw user-agent 或 IP。`current` 根据当前
resolved session ID 派生。

`DELETE /api/me/security/sessions/:sessionId` 只撤销当前账号拥有的 active session。成功返回
`204`，缺失或不属于当前账号返回 typed 404。

## 已授权应用

`GET /api/me/authorized-apps` 返回：

```ts
type AuthorizedAppSummary = {
  clientId: string;
  displayName: string;
  homeUrl: string;
  grantedScopes: string[];
  authorizedAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
};
```

不得返回 client secret、access/refresh token、authorization code、raw consent row 或 provider
metadata。

`DELETE /api/me/authorized-apps/:clientId` 撤销当前账号 grant，并清理/撤销关联 consent 和 token
material。成功返回 `204`，缺失或非本人 grant 返回 typed 404。

## 可执行来源

- `apps/app-api/src/app/routes/identity-platform.ts`
- `apps/app-api/src/modules/identity-platform/`
- `apps/app-api/src/db/schema/identity.ts`
- `apps/app-api/src/db/schema/auth.ts`

## 相关文档

- `../../architecture/system/identity-platform.md`
- `../../architecture/system/identity-browser.md`
- `../../data/identity-platform.md`
