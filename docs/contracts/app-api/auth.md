---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 登录与当前用户接口

## `ALL /api/auth/*`

- Better Auth 处理登录、注册、退出、会话、密码重置和账号关联子路由。
- `campus-web` 以同源路由形式向浏览器提供这些接口。
- Ops Web 使用 Cloudflare Access 应用策略准入人员，不复用终端用户登录流程。
- `POST /api/auth/sign-up/email` 必须携带
  `x-campus-legal-accepted: terms-and-privacy`；否则返回 `legal_consent_required`。
- 注册标记只用于当次准入，不保存为协议版本、IP、时间或账号级记录。
- `muc.edu.cn` 邮箱直接通过注册准入；其他邮箱必须存在当前环境的待领取或有效逐地址授权。
- 注册后必须完成邮箱验证。未验证、已封禁、正在注销或缺少邮箱授权的账号不能获得产品会话权限。
- 密码重置、邮箱验证和邀请邮件统一使用 `AUTH_EMAIL_FROM`，可选回复地址为
  `AUTH_EMAIL_REPLY_TO`。
- 使用临时密码登录的账号必须先完成改密，Campus Web 将其导向改密界面后再返回原页面。

## `POST /api/account/delete`

已登录用户提交当前密码申请注销。App API 验证密码后创建异步注销任务并撤销当前账号的
会话。任务依次清理个人记忆和账号关联数据，完成后删除 Better Auth 用户。
接口不接受用户 ID、立即删除选项或恢复参数。

请求正文：

```json
{ "password": "current-password" }
```

响应返回 `requestId` 和 `status`。密码错误或账号没有密码凭据时返回明确的重新认证
错误，不能把注销伪装成成功。

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
    "chat": true
  }
}
```

- 已登录普通用户默认投影为 `campus_member`。
- `sessionId` 来自服务端身份会话，不接受浏览器自造的会话标识。
- 无已解析用户的聊天请求返回 `session_required`，不创建匿名会话。
- 对普通终端用户，读取该接口会先更新当前身份会话投影。

## 可执行来源

- `apps/app-api/src/app/routes/auth.ts`
- `apps/app-api/src/modules/auth/`
- `apps/app-api/src/app/route-exposure-browser-inventory.ts`
