---
phase: "12"
name: "Staging Smoke And Planning Closeout"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 12 Summary

## What Closed

- staging 三端 health 已闭环：`campus-api-staging` 与 `campus-chat-staging` 返回 `200`，`campus-panel-staging` 继续由 Cloudflare Access 保护并返回 `302`。
- `public-chat-web -> app-api` 的真实浏览器链路已通过：`help_bot@outlook.com` 会话下 `POST /api/chat/requests` 返回 `200`，并记录了浏览器 `trace_ceccf8b43f674e10a889e65428b262e7` 与共享 `Sentry` trace `bb31243fafaf46b3bcec10126176dd2c`。
- `protected-panel-web -> app-api` 的真实浏览器链路已通过：`overview / quality / safety / cost / audit` 全部能通过真实左侧导航访问，相关 `/api/operator/*` 请求均返回 `200`；`overview` 与 `audit` 的 `Sentry` trace 已分别记录为 `cbe13b390a9844c1b1ddaa24e5635c9c` 与 `2ebf5d34584f4a0f810fefb6b199a6e5`。
- `Axiom` sink-side closeout 已完成：`campus-agent-runtime-dev` 中真实查询到 `projection.drain` 行，最新 staging 行记录 `processed_count=2`、`failed_count=0`、`projector_name=request_projection`、`release=app-api@staging-28f40e9`、`surface=app_api`，不再受 token scope 阻塞。
- 这条 workstream 的 planning truth 已全部收口到 completed：`Phase 12` 工件补齐，repo registry 不再把它当作 active，operator observability plan 入口已归档。

## Fresh Evidence

- `.tmp/observability-smoke/20260421-182650-staging-manual/SUMMARY.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/chat-trace.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/panel-trace.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/app-api-runtime-event.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/sentry-recent-spans.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `docs/plans/archive/completed/operator-observability-control-plane-foundation.md`

## Next State

- `operator-observability-control-plane` 当前正式 completed。
- 后续如需恢复，只能以新的 admitted operator domain、sink contract 改写或 write/action surface admission 为触发条件，新开 follow-up workstream，不再在本线追加 phase。
