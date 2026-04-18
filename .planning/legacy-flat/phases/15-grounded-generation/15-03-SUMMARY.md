# 15-03 Summary: eval gating 与 operator-safe adequacy / claim-support observability

## Outcome

Wave C 已把 grounded-generation 的关键真相从 specialist-local diagnostics 提升到 eval 与 operator release gate：

- `packages/evals` 现在把 retrieval adequacy 与 grounding claim truth 分开评分
  - `retrieval_adequacy_accuracy`
  - `grounding_claim_accuracy`
- Phase 15 新增并冻结了两条缺失的 deterministic eval lane：
  - `clarification_instead_of_guess`
  - `citation_required_answer`
- `app-api` 现在会把 Phase 15 summary truth 写入 `runtime.request_observability_fact`
  - `retrieval_adequacy_verdict`
  - `retrieval_adequacy_reason`
  - `claim_support_summary_json`
- operator detail 现在能区分：
  - retrieval base 本身不足
  - generation 后 grounding downgrade
  - 哪些 claim 类型 / 字段仍然 unsupported
- 整条观测链路保持 operator-safe：
  - 不暴露 raw `claim_supports`
  - 不暴露 support snippet dump
  - 不暴露 provider-native citation / support blob

## Key Changes

- `packages/evals/src/campus_evals/models.py`
  - 为 `GoldenCase` 增加 adequacy / grounding truth 字段
- `packages/evals/src/campus_evals/expectations.py`
  - 新增 `retrieval_adequacy_accuracy`
  - 新增 `grounding_claim_accuracy`
  - 增加 adequacy / grounding truth grading helper
- `packages/evals/src/campus_evals/scenarios.py`
  - 为 Phase 15 release-gate case 补齐 `citation_required_answer`
  - 为 handbook clarification case 补齐 `clarification_instead_of_guess`
- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
  - 解析 app-api 返回中的 adequacy / claim-support summary truth
- `packages/evals/src/campus_evals/runtime_observability.py`
  - 新增 `summarize_phase15_request_truth()`
- `apps/app-api/src/modules/request-diagnostics.ts`
  - 提炼 `claimSupportSummary`
  - 归一化 adequacy fields
- `apps/app-api/src/modules/request-observability.ts`
  - finalized observability fact 写入 adequacy / claim-support summary
- `apps/app-api/src/modules/runtime-command/store.ts`
  - 持久化 adequacy / claim-support summary 到 `runtime.request_observability_fact`
- `apps/app-api/src/modules/operator-query/store.ts`
  - operator detail 返回 adequacy / claim-support summary
- `apps/app-api/src/db/schema/runtime.ts`
  - 为 `runtime.request_observability_fact` 增加新列
- `apps/app-api/drizzle/0012_harsh_black_bird.sql`
  - 生成对应 migration
- `docs/contracts/app-api-supervisor-execution.md`
  - 记录 Phase 15 execution-side summary truth
- `docs/contracts/app-api-operator-observability-http.md`
  - 记录 operator-visible adequacy / claim-support summary contract
- `docs/data/app-api-schema.md`
  - 记录 runtime schema 新列与 operator-safe storage rule

## Verification

Fresh Wave C verification:

```bash
pnpm --dir apps/app-api exec vitest run \
  test/request-diagnostics.test.ts \
  test/request-observability.test.ts \
  test/operator-query.route.test.ts \
  test/operator-query.service.test.ts \
  test/supervisor-adapter.test.ts

pnpm --dir apps/app-api exec vitest run test/projection.service.test.ts
pnpm --dir apps/app-api exec tsc -p tsconfig.json --noEmit
uv run --all-packages --no-sync python -m unittest \
  tests.evals.test_golden_cases \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark
```

Result:

- `apps/app-api` targeted vitest lanes: `39 passed`
- `apps/app-api` `test/projection.service.test.ts`: `7 passed`
- `apps/app-api` typecheck: passed
- eval verification: `Ran 67 tests` / `OK`

## Next

- 进入 `15-04`
- 下一波用 focused verification 与 blocker-aware closeout 收口 Phase 15，并明确 live artifact refresh 仍受 supplemental provider `/responses` regression 阻断
