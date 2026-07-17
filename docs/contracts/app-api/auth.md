---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 登录与当前用户接口

## `ALL /api/auth/*`

- Better Auth 处理登录、注册、退出、会话、密码重置和账号关联子路由。
- `campus-web` 以同源路由形式向浏览器提供这些接口。
- `POST /api/auth/sign-up/email` 必须携带
  `x-campus-legal-accepted: terms-and-privacy`；否则返回 `legal_consent_required`。
- 注册标记只用于当次准入，不保存为协议版本、IP、时间或账号级记录。

## `GET /api/me`

返回当前已解析的用户、会话和权限摘要：

```json
{
  "principal": {
    "type": "campus_member",
    "principalId": "user_01HQ...",
    "displayName": "张三",
    "email": "user@example.edu"
  },
  "session": {
    "sessionId": "sess_01HQ...",
    "expiresAt": "2026-03-29T07:00:00.000Z"
  },
  "permissions": {
    "chat": true,
    "operator": false
  }
}
```

- 已登录普通用户默认投影为 `campus_member`。
- `sessionId` 来自服务端身份会话，不接受浏览器自造的会话标识。
- `operator` 权限来自受保护界面的可信身份传递。
- 无已解析用户的聊天请求返回 `session_required`，不创建匿名会话。
- 对普通终端用户，读取该接口会先更新当前身份会话投影。

## 可执行来源

- `apps/app-api/src/app/routes/auth.ts`
- `apps/app-api/src/modules/auth/`
- `apps/app-api/src/app/route-exposure-browser-inventory.ts`
