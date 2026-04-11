# 13-03 Summary

## Outcome

- `packages/evals` 现已补齐一组 cross-cutting `policy_risk_and_grounding_release_gate_cases()`，把四类关键路径冻结成独立 release-gate truth：
  - 校园范围内、证据充分的政治课程事实问句
  - 开放域政治事实问句 `out_of_scope`
  - 定向政治劝说请求 `policy_refusal`
  - specialist admitted 后因依据不足而 fail-close 的 `unsupported_by_evidence`
- `expectations.py` 现在会对 `TraceExpectation.expected_handoff` 做 machine-checkable grading，因此 eval 不再只看终态文本，还会明确区分：
  - supervisor 直接停止的 `none`
  - 已进入 `rag-specialist` 再返回的 specialist path
- `apps/app-api` 的 request observability fallback 已收敛到和 runtime 真相一致：
  - diagnostics-only 的 `out_of_scope` 不再被投影成 generic `unsupported_by_evidence`
  - diagnostics-only 的 grounding downgrade 会被投影成 `unsupported_by_evidence + failClosed=true`
  - supervisor stop 与 specialist downgrade 现在都能通过 `selectedTarget + refusalClass + semanticOutcome + scopeClass + failClosed` 一眼区分

## Verification

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_runtime_observability tests.evals.test_operator_observability`
  - `71 tests OK`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/request-observability.test.ts test/request-diagnostics.test.ts`
  - `5 tests OK`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_scope_policy tests.supervisor.test_supervisor_policy tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.specialist.test_rag_specialist tests.specialist.test_rag_prompting`
  - `211 tests OK`
