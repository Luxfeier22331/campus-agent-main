# 08-04 Summary

## Outcome

- `app-api` request execution / projection / operator query 现在携带 summary-level handbook diagnostics。
- `protected-panel-web` request detail 现在可展示这些 diagnostics。
- 架构与 schema 文档已同步到当前 merged truth。
- Phase 8 现已完成 closeout：fresh handbook live accept 在修复后重新转绿，可作为新的 release-truth baseline。

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
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
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
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/student-handbook-runtime-events.jsonl`
  - fresh rerun now succeeds through the repo bootstrap path and produces `.tmp/evals/student-handbook-formal-benchmark-accept-20260402T182346`
  - final verdict: `pass`
  - deterministic lane: stable `11/11` across all 3 reruns
  - supplemental gate: `pass`
  - key gate means: `judge.refusal_quality=0.9425`, `ragas.faithfulness=0.9511`, `ragas.answer_relevancy=0.8719`

## Closeout

- env/provider visibility 已被 `doctor_env` 与 fresh accept rerun 证实可用。
- handbook scholarship alias 的 procedure-style 误判，以及 resolved-policy unsupported clause 未 fail-close 的行为退化，都已通过本轮修复与 fresh artifact 验证收口。
- 后续如果再出现 handbook 回退，应以 `.tmp/evals/student-handbook-formal-benchmark-accept-20260402T182346` 作为最新 baseline 继续分析。
