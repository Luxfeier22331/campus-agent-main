# 11-04 Summary

## Outcome

- `supervisor` 现在有显式的 personalization-aware clarification seam：当请求缺少 `requested_scope` 时，只会把 user-visible profile/session 作为澄清文案提示，不会静默补全 scope 或改变路由真相。
- `rag-specialist` 现在只消费 `user_visible` profile memory 作为个性化 hint；`internal_only` memory 不再进入 intent framing、clarification wording 或 retrieval personalization hint。
- session confirmed slots 现在可以安全影响 `rag-specialist` 的 referential clarification wording，但仍不会升级成 hard resolution 或 authorization truth。

## Main Changes

- `packages/supervisor-core/src/campus_supervisor_core/context.py`
  - 新增 supervisor 内部 `SupervisorPersonalizationHint` 投影，只暴露安全的 actor/profile/session personalization 摘要。
- `packages/supervisor-core/src/campus_supervisor_core/intent.py`
  - `IntentFrame` 新增 explicit personalization decision point，并在缺少 scope 时只记录安全的 clarification subject。
- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
  - scope 缺失时支持基于安全 personalization hint 输出更具体的澄清文案，但仍保持 supervisor fail-close clarification。
- `packages/rag-specialist/src/campus_rag_specialist/intent.py`
  - `build_personalization_hint()` 只消费 `user_visible` profile memory；`internal_only` 记录不再进入 `recent_goal`。
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - clarification 文案现在可消费 confirmed slot terms，但只用于 wording，不改变 resolved target / retrieval filter。
- `tests/supervisor/test_supervisor_core.py`
- `tests/specialist/test_rag_specialist.py`
  - 新增 supervisor personalized scope clarification、specialist confirmed-slot clarification、internal-only memory ignore 回归测试。

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist`
  - `81` tests passed
