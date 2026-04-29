---
phase: "12"
name: "Staging Smoke And Planning Closeout"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 12 Context

**Gathered:** 2026-04-21
**Status:** Completed

<domain>
## Phase Boundary

本 phase 只负责：

- 以 staging 为准完成 `public-chat-web`、`protected-panel-web`、`app-api` 的真实 operator observability 验收
- 用真实 `Sentry` / `Axiom` sink 证据关闭 `projection.drain` 与跨 surface trace correlation 的剩余疑点
- 把 `operator-observability-control-plane` workstream 从 active 收口为 completed，并修正 repo 内所有 planning drift

它不负责：

- 新增 operator 写操作、ack / resolve / retry / export 能力
- 重开 `Requests` triage redesign 或新的 panel domain 扩面
- 把 panel 退化成 raw sink explorer、SQL console 或 trace viewer

</domain>

<decisions>
## Implementation Decisions

- **12-01:** `Phase 11` 之后的真实缺口是 staging/manual evidence 与 planning closeout，不再是实现缺口。
- **12-02:** `projection.drain` 必须以真实 `Axiom` 查询结果收口，而不是继续停留在 `Sentry` cron span 的间接推断。
- **12-03:** 收口时必须同时更新 workstream state、repo registry、plan archive 与 smoke artifact，避免 completed truth 与执行证据继续漂移。

</decisions>

<canonical_refs>
## Canonical References

- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/REQUIREMENTS.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/SUMMARY.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/SUMMARY.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/chat-trace.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/panel-trace.md`
- `.tmp/observability-smoke/20260421-182650-staging-manual/app-api-runtime-event.md`
- `docs/plans/archive/completed/operator-observability-control-plane-foundation.md`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `protected-panel-web` 的 `Requests` triage table redesign
- 新的 operator action/write surface
- 任何超出当前 read-only observability control-plane 的后续扩面

</deferred>
