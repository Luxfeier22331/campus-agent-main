---
doc_type: index
status: completed
created: 2026-05-04
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Workstream: Agents SDK Domain-Agent Adapter Promotion

这是 `agents-sdk-domain-agent-adapter-promotion` 的 native workstream 入口。

本 workstream 负责把 OpenAI Agents SDK 从已完成的
`agents-sdk-domain-agent-adapter-pilot` 推进到 default-on selected domain-agent adapter
substrate。
它的目标是减少 repo 自写 provider/tool loop glue，同时继续保留 Go `supervisor-api` 的
deterministic governance、AgentSpec / ToolSpec admission、workflow planning、fail-close 与
finalization ownership。

它不负责把 SDK 提升为 repo-wide orchestration owner，也不把 SDK-native graph、handoff、
trace、tool schema 或 run state 提升为 shared contract truth。

## Current Status

- status: completed, default-on domain-agent adapter admitted
- current phase: closed
- current slice: notice discover, all campus-services read-only structured tools and academic
  calendar SDK adapter tools
- product posture: SDK adapter defaults on and fails closed when provider/model/key/dependency is
  missing; `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED=false` is the kill switch
- deferred decision: broad multi-agent orchestration ownership remains out of scope
- public/chat dev evidence: `pnpm --dir apps/app-api chat:e2e:dev` passes through the local
  product entrypoint with a knowledge answer after the supervisor runtime image carries AgentSpec
  and canonical terminal responses include nullable `result` / `error`
- primary owner boundary: `apps/supervisor-agent-worker` + `apps/supervisor-api` +
  `packages/contracts` + `packages/evals`

## Why This Exists

旧 pilot 已证明 SDK 可以作为 bounded domain-agent adapter seam，但最终 posture 是
`keep_experimental_lane`，原因是：

- pilot target 是 `notice-agent + campus_notice_get`
- `campus_notice_get` 后续被重新收敛为 agent-internal selected notice/card/context resolve，
  不再是 agent-facing provider / SDK tool
- 当前 `_build_agents_sdk_notice_get_runner` 仍是 explicit disconnected stub
- 没有 live latency / cost / production-style parity evidence 支持 default promotion

现在 repo 已有：

- `AgentSpec` registry
- `ToolSpec` registry
- Go `WorkflowPlan.allowed_agents` / allowed tools admission
- `AgentRequest.workflow_context`
- `AgentInvocation` / tool provenance / eval trace gates

因此可以重新评估 SDK promotion，但目标必须从过时的 `campus_notice_get` 改为仍然打开的
read-only agent-facing structured handoff tools。

## Target Shape

长期接入形态固定为：

```text
Go supervisor-api
-> AgentSpec / ToolSpec / WorkflowPlan admission
-> AgentRequest with allowed_tools and bounded context
-> Python supervisor-agent-worker
-> Agents SDK-backed domain-agent adapter
-> repo-owned thin tool adapter / internal query service
-> bounded AgentResponse / StepOutputProjection
-> Go finalization
```

推荐推广顺序：

1. `notice-agent + campus_notice_discover` as admitted adapter
1. `campus-services-agent` read-only structured tools as admitted adapters
1. `calendar-agent + academic_calendar_lookup` as admitted adapter
1. defer `rag-agent` until agentic retrieval rearchitecture stabilizes
1. keep `navigation-agent` blocked until navigation product/runtime admission opens

Current decision:

- `campus_notice_discover` has `runtime_posture=sdk_adapter_admitted`.
- `campus_notice_get` remains `closed` and agent-internal only.
- `service_status_lookup`、`service_guide_lookup`、`transport_schedule_lookup`、
  `contact_directory_lookup` and `academic_calendar_lookup` are `sdk_adapter_admitted`.
- Runtime target/tool eligibility is derived from AgentSpec, ToolSpec and Go
  `AgentRequest.allowed_tools`; worker env no longer carries a target/tool allowlist.
- Public `/api/v1/answer` and `/api/v1/answer/stream` no longer direct-execute SDK-admitted
  structured payloads in Go. They enter Go-owned `single_step` bridge execution, then the
  Python worker routes the admitted tool through the Agents SDK adapter shell.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Relation To Existing Workstreams

- Builds on completed `agents-sdk-domain-agent-adapter-pilot`.
- Builds on completed `supervisor-multi-agent-runtime-contract-hardening`.
- Does not replace deferred `governed-multi-agent-workflow-runtime`.
- Must not interfere with active `agentic-rag-runtime-rearchitecture`.

Fixed split:

- This workstream owns SDK adapter promotion for selected domain-agent tool loops.
- `governed-multi-agent-workflow-runtime` owns broader multi-step workflow execution expansion.
- `agentic-rag-runtime-rearchitecture` owns RAG-internal planning/retrieval shape.

## Boundary Notes

- SDK `Runner` may execute an admitted agent step and admitted function tools.
- SDK handoff is not canonical by default; Go `WorkflowPlan` remains handoff owner.
- SDK traces are debug/eval inputs only and must be sanitized before repo surfaces.
- Hosted tools, remote MCP, web search, code interpreter, filesystem/shell, raw SQL, object-store
  reads, collector/runtime ingestion and index build remain forbidden query-time tools.
- State-changing tools remain out of scope.
- Provider/tool loop replacement must be evidence-driven and reversible.

## External Design Inputs

- OpenAI Agents SDK Python quickstart:
  `https://openai.github.io/openai-agents-python/quickstart/`
- OpenAI Agents SDK Python running agents:
  `https://openai.github.io/openai-agents-python/running_agents/`
- OpenAI Agents SDK Python tools:
  `https://openai.github.io/openai-agents-python/tools/`
- OpenAI Agents SDK Python handoffs:
  `https://openai.github.io/openai-agents-python/handoffs/`
- OpenAI Agents SDK Python tracing:
  `https://openai.github.io/openai-agents-python/tracing/`
