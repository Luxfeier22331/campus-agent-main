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
- 邮箱密码注册不直接建立会话。注册邮箱是否已经存在对浏览器返回相同的成功形态，Campus Web 随后
  显式调用 `POST /api/auth/send-verification-email`，不能用注册响应枚举账号。
- 注册后必须完成邮箱验证。未验证账号登录时只返回 `EMAIL_NOT_VERIFIED`，不在登录请求中隐式投递
  邮件；Campus Web 收到该错误后显式调用 `POST /api/auth/send-verification-email`。只有发送接口成功
  才能向用户声明邮件已发送并开始重发冷却。验证成功后 Better Auth 建立会话。未验证、已封禁、
  正在注销或缺少邮箱授权的账号不能获得产品会话权限。
- 邮箱验证和密码重置令牌有效期均为 1 小时。邮件动作链接只接受认证站点同源的 Better Auth 动作路径；
  注册、登录和更换邮箱的最终验证统一返回 `/account/verify-email/result`，更换邮箱的旧邮箱确认阶段返回
  账号设置。返回目标不能指向跨源、`/api/*` 或认证中转页面。
- 浏览器 `GET /api/auth/verify-email` 在执行前校验唯一的同源回调；跨源、API、认证中转和注销结果页
  回调直接拒绝。令牌过期、令牌无效和邮箱准入失败使用稳定错误码返回产品结果页，其他内部失败统一
  表示为 `VERIFICATION_FAILED`，不能向浏览器暴露供应商或数据库错误。
- Better Auth 限流响应使用 `X-Retry-After` 秒数，Campus Web 据此限制再次提交，不能用固定等待时间
  猜测服务端窗口。
- 密码重置、邮箱验证和邀请邮件统一使用 `AUTH_EMAIL_FROM` 作为发件人与回复地址，并在发送时使用
  `RESEND_API_KEY`。邮件投递配置缺失或投递失败只使对应
  邮件操作失败，不撤销已经创建的账号，也不改变已验证账号的登录和会话合同。
- 使用临时密码登录的账号必须先完成改密，Campus Web 将其导向改密界面后再返回原页面。

## `POST /api/account/delete`

已登录用户提交当前密码申请注销。App API 验证密码后创建异步注销任务并撤销当前账号的
会话。任务先要求 execution-control 建立 owner deletion fence、取消并排空活动 run，再清理
Hindsight 个人记忆；确认记忆已清除后删除 execution-control projection、App API 账号关联数据，
最后删除 Better Auth 用户。Temporal history 由其平台 retention 负责，不在该任务中同步删除。
接口不接受用户 ID、立即删除选项或恢复参数。

请求正文：

```json
{ "password": "current-password" }
```

响应返回 `requestId` 和 `status`。密码错误或账号没有密码凭据时返回明确的重新认证
错误，不能把注销伪装成成功。

### Dining 用户投稿注销

注销流程已通过 Dining 窄入口执行内容、身份和照片清理。流程保持本接口的当前密码校验、异步受理及会话撤销语义，不增加用户 ID、立即删除或恢复参数。

注销受理后，Dining 投稿、图片和关联评价立即停止公开，禁止本人继续写入和 Ops 普通恢复。
账号任务通过 Dining 的窄入口处理投稿正文、照片及必要身份；具体期限和治理数据最小保留见
[Dining PRD](../../product/dining.md)。公开撤下不能只依赖用户会话失效，后续公开请求仍须执行
对应可见性判定。

注销受理在锁定用户的同一事务内锁定作者投稿，完成撤下及按注销请求关联的清理登记。账号任务在删除认证用户与标记
completed 前确认 Dining 内容、身份及实际字节处理完成；未完成沿用 pending 和现有失败续接。
账号任务在处理 Dining 后续租；失败保留重试，尚未完成则 defer，过期 lease 不得删除认证用户或完成任务。
数据清理和最终完成的数据库入口再次复核 Dining 是否完成。独立 Dining sweep 也处理已受理注销，
不依赖 execution-control 配置。具体清理记录和完成条件见 Dining PRD，覆盖评价、举报及历史身份。
不得将 30 天清理上限变成所有注销任务必须空等 30 天；现有 execution-control 和 Hindsight
清理顺序不得因 Dining 扩展被绕过。

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
