# Phase 999.1: Smoke Evidence Deferred Backlog

## Purpose

这个 backlog 只收纳一类事项：

- 代码与定向验证已经收口
- 当前不再是 active implementation blocker
- 还缺 browser smoke、staging smoke 或截图/录屏类 evidence
- 适合等可 smoke 时统一补证据并一次性收口

它的目标是把这类 evidence-only follow-up 从 active execution lane 里剥离出来，避免后续文档继续把它们误写成当前实现缺口。

## Trigger

仅在以下条件成立时才从 backlog 取出执行：

- 本地浏览器 smoke lane 可用，或
- staging smoke lane 可用，且
- 相关 app 已部署到与当前代码一致的可验证环境

## Current Deferred Items

当前为空。

## Recently Closed

### `apps/public-chat-web` Wave 6 strict donor parity closeout

`2026-04-09` 已关闭。

关闭事实：

- donor diff whitelist 已落盘到 `docs/reference/public-chat-web-donor-diff-whitelist.md`
- `share / visibility on launch path` blocker 已关闭，并被 `public-chat-donor-diff-whitelist.test.ts` 固定为回归门禁
- fresh local gate 已通过：`pnpm --dir apps/public-chat-web test:worker`、`pnpm --dir apps/public-chat-web typecheck`、`pnpm --dir apps/public-chat-web build`
- authoritative authenticated staging smoke 已落盘到 `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/`
- `GET /api/models` staging 返回 `200`，`GET /api/history?limit=20` 在真实 cookie session 下返回 `200`

## Explicit Non-Items

当前没有需要继续保留在这个 backlog 下的 active item。

## Exit Rule

某一项只有在以下条件同时满足后才能从 active deferred items 移除：

- 对应 smoke evidence 已落盘
- 对应 source-of-truth 文档已同步更新
- 它不再被 `PROJECT.md`、`STATE.md` 或 active execution plan 表述为 pending evidence
