---
phase: "10"
name: "Sink Participation And Grade Backflow"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 10 Summary

## What Closed

- `apps/app-api` 已把 `Sentry` 的高基数字段从 searchable tags 收口进 structured request context；`request_id`、`safety_identifier` 不再作为 tag 写入。
- `apps/app-api` 已把 `Axiom` runtime sink 从 blacklist-only 改成 `event_type -> allowlist`，并统一补齐 `occurred_at / environment / release` canonical envelope。
- internal `quality` ingest seam 现在会在 `quality_grade_projection` upsert 成功后稳定发出 `quality.sampled_grade`。
- panel truth owner 保持不变：`protected-panel-web` 继续只消费 app-owned projection / aggregate / backlink，不直查 `Sentry`、`Axiom` 或 grader。
- shared-db integration 里的 auth runtime blocker 已被清除：测试环境现在补齐 Turnstile testing secret，真实 sign-up 请求也带上 dummy captcha token。

## Fresh Evidence

- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/telemetry.index.test.ts test/telemetry.axiom.test.ts test/operator-observability-command.service.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:shared-db-integration`

## Handoff

- 下一阶段固定进入 `Phase 11: Dev Smoke And Evidence`。
- `Phase 11` 重点是 dev seeded smoke、console/network/screenshot artifact 与回归证据，不再回头改写 Phase 10 的 sink ownership。
