---
doc_type: phase_summary
phase: "C"
phase_name: "Metric Rollup And Aggregate APIs"
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Phase C Summary

## Outcome

`apps/app-api` 已补齐 `GET /api/operator/safety/anomalies` 与 `GET /api/operator/cost/timeseries`，并保持它作为 operator observability aggregate read-model owner。

`apps/protected-panel-web` 已冻结 same-site `/api/operator/*` proxy namespace，明确与现有壳层 `/api/overview` 分离，为 `Phase D` 的 panel domain rollout 提供稳定 BFF seam。

## Implemented Surfaces

- `GET /api/operator/safety/anomalies`
- `GET /api/operator/cost/timeseries`
- panel same-site proxy:
  - `/api/operator/overview`
  - `/api/operator/quality/summary`
  - `/api/operator/quality/timeseries`
  - `/api/operator/quality/badcases`
  - `/api/operator/safety/summary`
  - `/api/operator/safety/anomalies`
  - `/api/operator/cost/summary`
  - `/api/operator/cost/timeseries`
  - `/api/operator/audit`
  - `/api/operator/audit/:auditEventId`

## Verification

- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/protected-panel-web test:worker`
- `RUN_APP_API_SHARED_DB_INTEGRATION=1 node ./scripts/run-with-local-env.mjs pnpm exec vitest run -c vitest.shared-db.config.mts test/operator-observability-shared-db.integration.test.ts`

## Notes

- 为跑通 shared-db integration，本地 shared DB 已应用 repo 当前 pending migration `0017_stormy_vanisher`。
- 全量 `pnpm --dir apps/app-api test:shared-db-integration` 仍被独立的 shared-product auth integration baseline 挡住；当前 workstream 相关的 operator integration 用例已单独通过。
