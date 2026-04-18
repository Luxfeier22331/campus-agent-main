# 14-03 Summary: prompt metadata sink、typed runtime state 与 deterministic-path regression closeout

## Outcome

Phase 14-03 已完成 product-path prompt runtime 的 observability / release-gate 收口：

- `apps/app-api` 现在会把 `PromptTrace` 的 `prompt_id`、`prompt_version`、`template_sha256` 投影进 `runtime.request_observability_fact`
- operator request observability detail 现在显式返回 prompt metadata 与 `prompt.runtimeState` / `prompt.runtimeDetail`
- supervisor / `rag-specialist` 在 prompt runtime fail-close 时不再只静默回退；`provider_refusal`、`provider_incomplete`、`content_filter` 等分支现在会落成 typed runtime state
- eval-side app-api runtime parser 与 runtime observability summary 现在能保留并聚合 prompt runtime state/detail
- handbook / curriculum deterministic-first protected paths 的 regression evidence 已补强，prompt rollout 不会把这些路径 silently 改回 prompt-first

## Key Changes

- `packages/shared/src/campus_shared/prompt_runtime.py`
  - 新增 prompt runtime failure classification helper
- `packages/contracts/src/campus_contracts/models.py`
  - 为 `RagResultDiagnostics` / `SupervisorObservability` 增加 `prompt_runtime_state`、`prompt_runtime_detail`
- `packages/supervisor-core` / `packages/rag-specialist`
  - 在 prompt runtime validation failure 时保留 typed runtime state，并继续 fail-close / deterministic fallback
- `apps/app-api`
  - `SupervisorExecutionObservability` 现解析 `prompt_trace`
  - request observability fact 新增 `prompt_id`、`prompt_version`、`template_sha256`、`prompt_runtime_state`、`prompt_runtime_detail`
  - operator detail 新增 `observability.prompt`
- `packages/evals`
  - app-api live runtime parser 保留 prompt runtime state / detail
  - runtime observability summary 聚合 `prompt_runtime_state_counts` / `prompt_runtime_detail_counts` / `content_filter_count`
- `docs/contracts` / `docs/data`
  - 补齐 supervisor execution、operator observability、runtime schema 的 prompt metadata / runtime state truth

## External Alignment

2026-04-12 已按官方资料复核当前 Phase 14 设计，结论是本次收口方向与当前推荐口径一致：

- OpenAI 现将 Responses API 作为新的 text-generation building block；repo 主链路继续以 `apps/supervisor-api` prompt stack + provider-backed executor 承载是合理的
- 应用拥有的高优先级规则应继续放在 developer/instructions 层，而不是把 untrusted user/evidence 文本拼回高信任 instruction zone
- strict structured outputs、显式 refusal / incomplete handling、以及持续 eval 都是当前官方建议的主线，因此本 phase 把 prompt metadata sink、typed runtime state、deterministic-path regression 一并收口是正确方向

Reference:

- https://developers.openai.com/api/docs/guides/text
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://platform.openai.com/docs/guides/evaluation-best-practices

## Verification

Fresh targeted verification:

```bash
pnpm --dir apps/app-api exec vitest run \
  test/request-observability.test.ts \
  test/supervisor-adapter.test.ts \
  test/operator-query.route.test.ts \
  test/chat-command.service.test.ts \
  test/chat-requests.route.test.ts \
  test/operator-query.service.test.ts \
  test/shared-database-adoption.test.ts

pnpm --dir apps/app-api exec tsc --noEmit

uv run --all-packages --no-sync python -m unittest \
  tests.contracts.test_models \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark \
  tests.supervisor.test_supervisor_core \
  tests.supervisor.test_supervisor_policy \
  tests.specialist.test_rag_specialist \
  tests.api.test_supervisor_api \
  tests.api.test_supervisor_api_prompt_stack
```

Result:

- app-api targeted Vitest: `75` tests, `OK`
- targeted Python unittest: `258` tests, `OK`
- app-api `tsc --noEmit`: `OK`

## Follow-up

- Phase 14 已收口；剩余 prompt/hallucination 长期工作不再是 metadata sink，而是以下四项：
  1. 将 grounding validator 升级为 provider-agnostic grounded-generation runtime
  2. 将 claim taxonomy 从 `title / time / requirement` 扩展到数量、学分、学期、适用对象、开课单位、流程材料期限条件、freshness 等校园高频断言类型
  3. 为新增 claim 类型补齐 per-claim regression / eval coverage
  4. 补齐 prompt-family regression artifact retention 与后续 live gate artifact 更新
