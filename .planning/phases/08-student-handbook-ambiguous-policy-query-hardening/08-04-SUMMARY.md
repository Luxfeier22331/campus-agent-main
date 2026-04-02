# 08-04 Summary

## Outcome

- `app-api` request execution / projection / operator query 现在携带 summary-level handbook diagnostics。
- `protected-panel-web` request detail 现在可展示这些 diagnostics。
- 架构与 schema 文档已同步到当前 merged truth。
- Phase 8 不能记为 complete，因为 live handbook accept 仍缺环境凭据。

## Main Changes

- `apps/app-api/src/modules/request-diagnostics.ts`
  - 新增 typed summary diagnostics 归一化
- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/app-api/src/modules/runtime-command/store.ts`
  - 从 supervisor `result.diagnostics` 提取并持久化到 `runtime.request_execution`
- `apps/app-api/src/modules/projection/service.ts`
- `apps/app-api/src/modules/projection/store.ts`
- `apps/app-api/src/modules/operator-query/service.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
  - 物化并暴露 operator-facing diagnostics
- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/db/schema/operator.ts`
- `apps/app-api/drizzle/0001_stormy_zzzax.sql`
  - 新增 `diagnostics_json`
- `apps/app-api/scripts/adopt-shared-database.mjs`
  - 支持 `ALTER TABLE ... ADD COLUMN ...` migration adoption
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/src/panel/requests/request-show.tsx`
  - detail view 显示 resolved policy / rewritten query / reason code / retrieved titles
- `docs/architecture/retrieval-query-strategy.md`
- `docs/architecture/rag-specialist-architecture.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/data/app-api-schema.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

## Verification

- `pnpm web:typecheck`
  - pass
- `pnpm web:test`
  - pass
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .`
  - pass
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl`
  - blocked: `ValueError: LLM_API_KEY is required`

## Remaining External Blocker

- 提供 eval 侧 `LLM_API_KEY`（以及 live accept 所需相关凭据）后，重跑 handbook live accept。
- 在该命令成功前，Phase 8 仍应保持 blocked，而不是 complete。
