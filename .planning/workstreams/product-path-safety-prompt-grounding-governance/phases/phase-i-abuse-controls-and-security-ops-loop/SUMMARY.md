---
doc_type: phase_summary
phase: "I"
phase_name: "Abuse Controls And Security Ops Loop"
created: 2026-04-19
updated: 2026-04-19
---

# Phase I Summary

## Outcome

- `app-api` public/product-path 现在会在第一次 durable accept 之后，以 canonical `safety_identifier` 读取 `runtime.request_execution` 并执行最小 abuse throttle。
- throttle 命中时，请求固定收口为 `status=rejected`、`error_code=rate_limit_exceeded`，并跳过 `apps/supervisor-api`。
- `GET /api/operator/overview` 的 `alerts[]` 已从 `runtime.request_observability_fact` 派生真实 safety alerts：
  - `safety.rate_limit_exceeded`
  - `safety.remote_content_suspicion_spike`
  - `safety.provider_content_filter_spike`
- content-oriented alerts 会显式标记 `incidentBackfill.required=true`，把 closeout 接回 `incident_backfill` 治理口径。
- runtime 为 `safety_identifier` lookup 新增了 `request_execution` / `request_observability_fact` 复合索引。

## Verification

- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/runtime-command.store.test.ts test/operator-query.store.test.ts test/operator-query.route.test.ts`
- `pnpm --dir apps/app-api run db:generate`

## Next State

- 这条 workstream 在 `Phase I` 正式收口完成，不再为 `Phase J/K` 保持 conditional hold。
- future moderation lane 与 HITL approval recovery 已迁到 `.planning/seeds/SEED-001-conditional-moderation-lane.md` 和 `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md`，只有未来 scope trigger 命中时才重新规划。
