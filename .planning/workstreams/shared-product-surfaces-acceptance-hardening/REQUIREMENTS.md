---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-20
---

# Requirements: Shared Product Surfaces Acceptance Hardening

## Goal

在已冻结的 shared product topology 上，先按 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout` 完成三端联合验收，再继续收口 shared `app-api + public-chat-web` 的 public auth surface：登录页产品化、forgot/reset password、mailer contract 与 auth smoke。

## In Scope

- `apps/app-api` shared backend seam 基线
- `apps/public-chat-web` product acceptance
- `apps/public-chat-web` end-user auth shell productization
- `apps/public-chat-web` mature auth shell layout cutover
- forgot/reset password browser flow
- `apps/app-api` Better Auth password reset backend 与 auth mailer contract
- `apps/protected-panel-web` 当前开放域 acceptance
- chat 到 panel `Requests` 的 integrated acceptance
- staging preflight 与 planning closeout

## Non-goals

- 改写 shared product topology
- 把 `apps/supervisor-api` 重新升格为 product backend
- 为 panel 新建独立 backend
- 把 panel 做成 end-user password product
- 打开 `Jobs` / `Operations` / `Audit`
- 混入 official-web、authenticated-notice、regulation import 等数据面工作

## Success Criteria

1. `app-api` 的 auth/session/chat ingress/request projection/operator query 基线成立。
2. public chat 的 same-site path、首次发送、reload/history 稳定可用。
3. protected panel 可稳定消费 `Overview`、`Requests`、`Official Web` 三个开放域。
4. public chat 发起的真实请求能在 panel `Requests` 中以同一条 projection 被消费。
5. staging preflight 结果与 planning closeout 口径一致，不把 preflight 成功误写成 staging smoke 已完成。
6. `/login` `/register` 不再处于长期 out-of-scope 灰区，而是正式 public auth surface。
7. end-user 可以通过 forgot/reset password 完成真实账户恢复，而不依赖手工改库。
8. auth mail provider / secret / runbook truth 与 same-site recovery flow 同步成立。
9. `/login` `/register` `/forgot-password` `/reset-password` 共享一套成熟的 public auth shell，不再保留右侧聊天窗口预览或 demo 式 split preview。

## Canonical Entry

- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
