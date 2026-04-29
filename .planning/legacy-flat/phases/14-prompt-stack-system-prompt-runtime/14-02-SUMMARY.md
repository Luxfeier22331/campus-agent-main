# 14-02 Summary: provider-backed strict prompt executor 与 PromptTrace metadata

## Outcome

Phase 14-02 已把 `apps/supervisor-api` 的 prompt runtime seam 从 assembly-only 推进为 product-path provider-backed strict executor：

- `apps/supervisor-api` 现可为 supervisor / rag prompt families 组装 `Responses` strict structured-output request
- runtime 现在会在产品主链路上生成并验证 `PromptTrace`
- `prompt_id`、`prompt_version`、`template_sha256`、`model_provider`、`model_name` 已成为产品路径上的真实 metadata，而不是测试夹具字段
- provider `refusal`、`incomplete` 与 provider-side request/schema error 现已 fail-close，而不是被当作 schema success 放行
- `create_app()` 现在会在 provider / model / api key 条件满足时接入 provider-backed prompt executors，并在 runtime/`readyz` 暴露 prompt-runtime admission truth

## Key Changes

- `packages/shared/src/campus_shared/prompt_runtime.py`
  - 新增 strict structured Responses executor seam
  - 新增 `PromptRuntimeHTTPSettings` / `PromptRuntimeProviderConfig`
  - 新增 `build_prompt_trace(...)`
  - 强化 `PromptTrace` validation，要求 model metadata 非空
  - 对 `refusal` / `incomplete` / provider request failure 显式 fail-close
- `apps/supervisor-api/src/campus_supervisor_api/prompt_executor.py`
  - 新增 provider-backed supervisor/rag prompt executor adapter
- `apps/supervisor-api/src/campus_supervisor_api/settings.py`
  - 新增 prompt runtime provider/base_url/api_key/transport/reasoning/max_output_tokens env seam
- `apps/supervisor-api/src/campus_supervisor_api/app.py`
  - 新增 prompt runtime admission / executor wiring
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
  - `readyz` 现暴露 `prompt_runtime.transport` 与 `prompt_runtime.admitted`
- tests
  - 新增 product-path provider executor tests
  - 补齐旧 prompt trace fixture 的 model metadata

## Verification

Fresh targeted verification:

```bash
uv run --all-packages --no-sync python -m unittest \
  tests.api.test_supervisor_api \
  tests.api.test_supervisor_api_prompt_stack \
  tests.api.test_supervisor_api_prompt_executor \
  tests.shared.test_prompt_runtime \
  tests.supervisor.test_supervisor_prompting \
  tests.supervisor.test_supervisor_core \
  tests.supervisor.test_supervisor_policy \
  tests.specialist.test_rag_prompting \
  tests.specialist.test_rag_specialist
```

Result: `Ran 207 tests`, `OK`

## Remaining Gap For 14-03

- `refusal` / `incomplete` / `content_filter` 仍主要以 fail-close runtime error 形式存在，尚未形成更强的 observability-safe typed product state
- `PromptTrace` metadata 已进入产品主链路，但 `apps/app-api` / operator projection / release-gate coverage 还未完成 repo-default 收口
- deterministic protected paths 仍需补更明确的 regression / release-gate evidence，防止后续 prompt runtime 扩面时漂移
- 结构上仍有一个待评估项：当前 provider transport helper 仍部分放在 `packages/shared`；14-03 应决定是否将这部分进一步收回 `apps/supervisor-api`，只把纯 prompt-runtime helper 留在 shared
