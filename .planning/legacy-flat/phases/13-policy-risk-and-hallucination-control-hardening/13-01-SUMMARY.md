# 13-01 Summary

## Outcome

- supervisor 现在显式区分了三类 Phase 13 的首轮 product-path 分流：
  - 校园内政治/思政课程类问题继续走 in-scope knowledge path
  - 开放域政治事实问句（如国家元首/总统类）直接落为 `out_of_scope`
  - 定向政治劝说/拉票/影响类请求直接落为 `policy_refusal`
- `finalize_routing_decision()` 不再把所有 rejected path 的 `policy_reason` 抹平成 `request_rejected`；现在会保留诸如 `political_persuasion` 这样的具体原因，供 observability/eval 后续消费。
- stale API regression 已同步到当前 merged truth：generic 裸知识问句默认走 `needs_clarification`，而不是 API shell 侧 `400 missing_routing_input`。

## Verification

- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_scope_policy tests.supervisor.test_supervisor_policy tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_core tests.api.test_supervisor_api`
  - `80 tests OK`
