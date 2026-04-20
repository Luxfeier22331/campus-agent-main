---
doc_type: plan
status: completed
created: 2026-04-18
updated: 2026-04-21
---

# Shared Product Surfaces Acceptance And Hardening

## Completion Note

这条 shared product surfaces workstream 已关闭。
它完成的是 `app-api`、`public-chat-web`、`protected-panel-web` 三端的联合验收与产品化硬化，
包括 public auth family、staging continuity，以及 browser-facing answer citation hygiene。

## What This Plan Closed

- 固定 `app-api -> public-chat-web -> protected-panel-web` 的联合验收顺序与 shared seam 归因方式
- 收口 public auth shell、password reset、adaptive Turnstile posture 与 live-browser continuity
- 固定 `protected-panel-web` 当前开放域与 `Requests` ownership 不回退
- 补齐 browser-facing answer prose 的 raw locator hygiene guard，不再把 `doc_id#chunk_id` / `chunk-*` 暴露给终端用户

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 public auth family、same-site auth contract、Turnstile runtime posture、
或 browser-facing answer citation hygiene 被显式改写，
或者 shared `app-api + public-chat-web + protected-panel-web` 联合验收被重新 admission 为 active hardening 时，
才应恢复这条 workstream。
