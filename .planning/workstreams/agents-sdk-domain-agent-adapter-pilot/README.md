---
doc_type: index
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Agents SDK Domain-Agent Adapter Pilot

这是 `agents-sdk-domain-agent-adapter-pilot` 的 native workstream 入口。

本 workstream 负责把 OpenAI Agents SDK 作为 bounded domain-agent adapter 进行
repo 内试点。它不把 Go `supervisor-api` 改成 SDK triage agent，不把 SDK-native
tool schema / run state / trace 提升为 shared contract truth，也不把 provider-native
function calling 或 MCP 扩成顶层 orchestration owner。

## Current Status

- status: `active`
- current phase: `Phase 2 ready`
- active implementation: Phase 1 default-off dependency/admission/readiness gate complete
- current slice: constrain SDK tool surface to ToolSpec + Go allowed_tools before any SDK run execution

## Why This Exists

当前 repo 已有 repo-owned `ToolSpec` registry、Go `allowed_tools`、Python
provider function-call pilot、workflow trace/eval guardrail 方向，以及 deferred 的
governed multi-agent workflow runtime。下一步需要验证一个具体问题：

```text
Can an agent framework reduce custom provider-loop glue while preserving
Go-owned admission, ToolSpec truth, typed result projection, and fail-close semantics?
```

因此本 workstream 先只试点 SDK 作为 Python domain-agent 内部 adapter。试点成功只证明
SDK 可以承接局部 agent loop ergonomics；不自动打开 multi-agent runtime，也不自动替换
现有 provider adapter。

## Target Shape

长期接入形态固定为：

```text
Go supervisor-api deterministic admission
-> AgentRequest / allowed_tools / WorkflowPlan
-> Python supervisor-agent-worker
-> SDK-backed domain-agent adapter
-> repo-owned thin tool adapter / internal query service
-> bounded AgentResponse / StepOutputProjection
-> Go finalization
```

默认协作模式仍是 manager-style：

- Go `supervisor-api` 保持 admission、allowed tools、budget、timeout、fail-close、
  workflow trace skeleton 与 finalization ownership。
- SDK-backed domain-agent 只能消费 Go handoff 中已经允许的 tools。
- SDK tool output 必须先收敛为 repo-owned typed/bounded projection。
- SDK run/trace 只能作为 debug/eval input；进入 app-api、panel 或 eval 前必须转换为
  repo-owned sanitized projection。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不引入 SDK 类型到 `packages/contracts`。
- 不把 hosted MCP、built-in web search、filesystem、shell、raw SQL、object-store bytes、
  collector runtime、ingestion/index build 暴露为 query-time tool。
- 不打开 state-changing tool；未来若涉及提交、预约、申请、支付或工单，另开
  approval / HITL / audit / rollback / eval workstream。
- 不把 deferred 的 `governed-multi-agent-workflow-runtime` 合并到本 workstream；本线只验证
  SDK adapter substrate。

## External Design Inputs

- OpenAI Agents SDK:
  `https://developers.openai.com/api/docs/guides/agents`
- OpenAI Agents SDK orchestration:
  `https://developers.openai.com/api/docs/guides/agents/orchestration`
- OpenAI Agents SDK observability:
  `https://developers.openai.com/api/docs/guides/agents/integrations-observability`
- OpenAI guardrails and approvals:
  `https://developers.openai.com/api/docs/guides/agents/guardrails-approvals`
