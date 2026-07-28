---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 账号准入接口

## 读取

`GET /api/ops/email-access-grants` 返回当前 App API 环境、当前页邮箱授权和下一页游标。
查询支持邮箱、`invitation | test` 和
`pending | active | revoked | expired`。

列表中的“最近发送”来自 `lastInvitationSentAt`，只表示邮件服务接受发送请求的时间，不表示最终
送达或读取；空值显示为尚未被邮件服务接收。

## 写入

- `POST /api/ops/email-access-grants` 创建授权并发送邀请；
- `POST /api/ops/email-access-grants/:grantId/resend` 重发未过期的待领取邀请；
- `POST /api/ops/email-access-grants/:grantId/revoke` 撤销待领取或有效授权。

写操作要求通过统一 Cloudflare Access 人员准入、同源请求、JSON 正文和 `Idempotency-Key`。
Ops Web 将操作者标识和
幂等键转发给 App API 专用管理接口，不直连 `app_auth`。

浏览器和服务端均不接受域名通配、环境覆盖、用户 ID 指定或账号状态修改。production 不提供
测试授权；邮件发送失败时授权保持待领取，接口必须明确返回失败，不能把已创建授权显示为全部成功。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
