---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Shared Product Surfaces Acceptance Hardening

## Goal

在已冻结的 shared product topology 上，按 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout` 的固定顺序，完成三端联合验收与硬化。

## In Scope

- `apps/app-api` shared backend seam 基线
- `apps/public-chat-web` product acceptance
- `apps/protected-panel-web` 当前开放域 acceptance
- chat 到 panel `Requests` 的 integrated acceptance
- staging preflight 与 planning closeout

## Non-goals

- 改写 shared product topology
- 把 `apps/supervisor-api` 重新升格为 product backend
- 为 panel 新建独立 backend
- 打开 `Jobs` / `Operations` / `Audit`
- 混入 official-web、authenticated-notice、regulation import 等数据面工作

## Success Criteria

1. `app-api` 的 auth/session/chat ingress/request projection/operator query 基线成立。
2. public chat 的 same-site path、首次发送、reload/history 稳定可用。
3. protected panel 可稳定消费 `Overview`、`Requests`、`Official Web` 三个开放域。
4. public chat 发起的真实请求能在 panel `Requests` 中以同一条 projection 被消费。
5. staging preflight 结果与 planning closeout 口径一致，不把 preflight 成功误写成 staging smoke 已完成。

## Canonical Entry

- `docs/plans/shared-product-surfaces-acceptance-hardening.md`
