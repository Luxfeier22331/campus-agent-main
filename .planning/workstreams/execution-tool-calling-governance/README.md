---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Execution Tool Calling Governance

这是 `execution-tool-calling-governance` 的 native workstream 入口。

本 workstream 收口 execution path 中的 tool / function-calling 治理：把当前分散在
Go runtime policy、structured planner、Python agent worker、contracts、eval fixtures
与 docs 中的 tool truth，升级为 repo-owned `ToolSpec` registry、严格
`allowed_tools` contract、domain-agent 内部 provider-native function calling adapter
边界，以及可观测、可评测、可 fail-close 的 tool call lifecycle。

## Current Status

- status: `completed`
- current phase: `Phase 14 completed`
- active implementation: completed
- current slice: closeout and guardrails

## Why This Exists

当前 repo 已经有 tool 相关机制：

- Go `supervisor-api` 生成 `allowed_tools`
- structured planner 选择 `transport_schedule_lookup`、`service_status_lookup`、
  `service_guide_lookup`、`contact_directory_lookup`、
  `campus_notice_discover`、`campus_notice_get`
- `AgentRequest` / `AgentResponse` 承载 agent handoff 与 payload
- eval fixtures 已覆盖一部分 selected tool / workflow trace denominator

但 tool truth 仍分散在多个位置。后续如果引入 OpenAI function calling、Agents SDK、
MCP 或其他 provider-native tool loop，必须先保持 repo-owned admission、source trust、
ToolSpec、eval 与 observability 不被 provider substrate 替代。

## Target Shape

长期目标固定为：

```text
Go supervisor-api deterministic admission
-> ToolSpec / allowed_tools
-> domain-agent optional provider-native tool loop
-> thin adapter
-> repo-owned internal query service
-> sanitized result projection
-> Go finalization
```

Provider tool loop pilots must submit bounded `function_call_output` back to the
provider with the original provider `call_id`; provider call ids are correlation
fields only and do not replace repo-owned workflow ids.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 本 workstream 只处理 execution tool / function-calling governance。
- 不重开 collection ingestion、OCR、source-truth、chunk/index build 或 serving alias
  迁移。
- 不把 provider-native function calling 作为顶层 orchestration owner。
- 不把 remote MCP、built-in web search、raw SQL、raw object-store read、collector crawl、
  ingestion write 或 index build 暴露为 public chat query-time tool。
- state-changing tool 默认不进入 campus 主路径；如未来 admission，必须另开
  approval / HITL / audit / rollback / eval contract。

## External Design Inputs

- OpenAI Tools / function calling direction:
  `https://platform.openai.com/docs/guides/tools`
- OpenAI function calling help:
  `https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api`
- OpenAI Agents SDK direction:
  `https://platform.openai.com/docs/guides/agents-sdk`
