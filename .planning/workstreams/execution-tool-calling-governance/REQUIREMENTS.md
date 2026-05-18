---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Execution Tool Calling Governance

## Goal

建立 repo-owned tool / function-calling governance，使 tool admission、tool schemas、
provider-native function calling adapter、tool lifecycle、observability 与 eval denominator
有单一长期真相。

目标不是马上把所有 agent 执行迁到 provider-native function calling，而是先把 tool
治理边界收口，确保后续可以安全引入 provider tool loop。

## Primary Requirements

- 新增 canonical `ToolSpec` registry，固定 tool name、owner agent、capability family、
  payload / result schema、read-only posture、opening gate、source-truth owner、
  query service owner、timeout、max result size、parallel-call policy、fail-close reason
  与 eval denominator。
- Go `supervisor-api` 的 allowed tool truth 必须来自 `ToolSpec` 或被 `ToolSpec`
  drift guard 校验。
- Python `supervisor-agent-worker` / domain-agent 只能消费 Go handoff 中的
  `allowed_tools`，不得自行扩大工具集合。
- Provider-native function calling 只作为 domain-agent 内部 adapter；不能替代 Go
  supervisor admission、routing policy、opening gate、fail-close finalization 或 source
  trust。
- Provider function schema availability and provider runtime opening must remain
  separate: `function_schema.available` only means a strict provider schema can
  be generated; `runtime_posture` and env admission decide whether a provider
  loop may execute.
- Provider tool loops must follow the Responses-style lifecycle: receive a
  function call, execute the repo-owned tool, submit bounded `function_call_output`
  with the original provider `call_id`, and only then consume provider final
  answer text.
- Tool call lifecycle 必须可观测、可重放、可评测，至少包含 workflow run id、step id、
  tool call id、tool name、sanitized argument summary、result status、business outcome、
  fail-close reason、latency / timeout / retry summary、source refs 或 result hash。
- Tool result 必须先转成 bounded result projection 或 `StepOutputProjection`，再进入
  answer synthesis、workflow trace、operator projection 或下一步 handoff。
- `packages/evals` 必须覆盖 selected tool correctness、argument precision、
  should-call / no-call、fail-close correctness、tool output usage 与 hallucinated tool
  prevention。

## Initial Tool Set

第一批治理对象：

- `transport_schedule_lookup`
- `service_status_lookup`
- `service_guide_lookup`
- `contact_directory_lookup`
- `campus_notice_discover`
- `campus_notice_get`
- `retrieval.query`

## Non-Goals

- 不把 provider-native function calling 直接打开到 public product path。
- 不引入 general web fallback。
- 不把 remote MCP 作为 answer-bearing source。
- 不把 ingestion / OCR / index build 暴露为 query-time tool。
- 不实现预约、申请、提交、支付、工单创建或任何状态变更 tool。
- 不把 `packages/contracts` 扩成 runtime / provider SDK 类型承载层。

## Success Criteria

- Tool truth 不再散落在 Go、Python、contracts、eval fixtures 与 docs 中而无法校验。
- 新增或修改 tool 时必须同时通过 ToolSpec schema、Go allowed-tools drift guard、
  Python adapter boundary test、provider schema snapshot test 与 eval denominator check。
- Provider-native function calling adapter 可以在单个低风险 tool 上 dry-run 或 gated
  runtime pilot，通过 strict schema、bounded result projection 与 trace projection 验证。
- `pnpm docs:lint`、相关 Go tests、Python focused unittests、contract generation check、
  eval focused tests 与 `git diff --check` 通过。

## Stable References

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/contracts/campus-notice-runtime-contract.md`
- `docs/contracts/service-status-lookup-contract.md`
- `docs/contracts/transport-schedule-lookup-contract.md`
- `docs/contracts/service-guide-lookup-contract.md`
- `docs/contracts/contact-directory-lookup-contract.md`
- `packages/contracts/src/campus_contracts/models_runtime.py`
- `packages/contracts/src/campus_contracts/models_tools.py`
- `apps/supervisor-api/internal/runtimepolicy/tools.go`
- `apps/supervisor-api/internal/structuredplanning/`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/`
- `packages/evals/fixtures/tool_family_denominators.v1.json`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
