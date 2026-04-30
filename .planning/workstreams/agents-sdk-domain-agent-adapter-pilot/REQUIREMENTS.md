---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Agents SDK Domain-Agent Adapter Pilot

## Goal

在不改变 repo-owned orchestration truth 的前提下，引入 OpenAI Agents SDK 作为
Python domain-agent 内部 adapter 候选，验证它能否替代部分自研 provider-loop glue，
同时保留 Go admission、ToolSpec、typed projection、fail-close、observability 与 eval
边界。

## Primary Requirements

- Agents SDK 只能作为 `apps/supervisor-agent-worker` / domain-agent 内部 runtime
  substrate，不得成为 repo-level orchestration owner。
- Go `apps/supervisor-api` 继续拥有 deterministic admission、capability/lane/scope/version
  guard、`allowed_tools`、workflow policy、fail-close terminal semantics 与 finalization。
- SDK-backed adapter 输入必须是 Go 已投影的 `AgentRequest` / routing frame；不得在 Python
  中重新推断 capability、scope、version 或全局 routing truth。
- SDK tool 集合必须由 `ToolSpec` + Go `allowed_tools` 派生或校验；SDK decorator/schema
  不得成为 canonical tool schema。
- SDK function tools 只能调用 repo-owned thin adapter / internal query service；不得直接读
  raw source、raw SQL、object store bytes、collector runtime、ingestion/index build path。
- SDK run result、trace、handoff state、tool call object 与 raw model output 不得写入
  `packages/contracts`、public response、operator projection 或 eval canonical artifact。
- SDK trace 可以作为 debug/eval input，但必须经过 repo-owned sanitized projection 后进入
  `workflow_trace_summary`。
- First pilot 必须 default-off、read-only、single-tool 或 serial-loop；不得打开 provider
  parallel tool calls，除非 ToolSpec、runtime posture、eval denominator 与 merge policy
  全部明确允许。
- SDK runtime readiness 必须与 prompt/provider readiness 分离：缺 dependency、缺 key、缺
  model、gate 关闭、allowed target/tool 不匹配时都应给出稳定 admission reason。

## Initial Pilot Scope

第一批只允许选择一个低风险 read-only pilot：

- preferred: `campus_notice_get`
- allowed alternative: `campus_notice_discover`

选择原因：

- 已存在 ToolSpec / provider function schema / default-off provider function-call pilot。
- 可以与现有 custom Responses loop 做 parity 对照。
- 不需要打开 state-changing capability。
- 不依赖 deferred multi-agent workflow runtime。

## Non-Goals

- 不迁移 Go supervisor runtime。
- 不重写 `rag-agent` 全量 reasoning loop。
- 不把 Agents SDK handoff graph 提升为 current architecture truth。
- 不引入 Claude Agent SDK、Agno AgentOS、LangGraph 或其他 framework 作为同一阶段并行
  runtime。
- 不新增 open web / MCP answer-bearing fallback。
- 不处理 ingestion、OCR、collection、index build 或 object storage lifecycle。
- 不打开 public product path；所有 runtime opening 必须经过 explicit env gate 和 eval evidence。

## Success Criteria

- 新增 SDK dependency 和 readiness gate 不影响默认生产路径。
- SDK adapter 可以在 default-off lane 中执行一个 admitted read-only tool loop。
- SDK adapter 只能看到 Go `allowed_tools` 子集；wrong tool、missing tool、invalid arguments、
  malformed result、query service failure 都 fail-closed 为结构化 `AgentResponse`。
- SDK tool output 经过 bounded projection 后再进入 final answer synthesis 或 trace summary。
- SDK trace/raw response 不泄漏到 shared contracts、public response、operator panel 或 eval
  canonical surface。
- Existing provider function-call pilot 与 SDK pilot 可以用相同 denominator 对比。
- Focused Go/Python/eval/docs checks 通过，且新增 guard 防止 SDK 反向接管 ToolSpec truth。

## Stable References

- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`
- `.planning/workstreams/execution-tool-calling-governance/README.md`
- `.planning/workstreams/governed-multi-agent-workflow-runtime/README.md`
- `configs/runtime/tools.v1.json`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/provider_function_calling.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_function_schema.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_spec_registry.py`
- `tests/supervisor/provider_function_calling_suite.py`
- `tests/supervisor/tool_spec_registry_suite.py`
- `tests/contracts/contract_boundary_guardrails_suite.py`
