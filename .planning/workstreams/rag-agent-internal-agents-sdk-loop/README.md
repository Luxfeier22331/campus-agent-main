---
doc_type: index
status: completed
created: 2026-05-05
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Workstream: RAG Agent Internal Agents SDK Loop

这是 `rag-agent-internal-agents-sdk-loop` 的 native workstream 入口。

本 workstream 负责把 OpenAI Agents SDK 引入 `rag-agent` 的内部语义执行 loop，用官方 SDK
承担 agent loop、function tool invocation、structured output、guardrail 与 sanitized trace
projection，同时继续保留 repo-owned supervisor、retrieval、contracts 与 finalization 边界。

它不负责自研 SDK，也不把 SDK 提升为 repo-wide orchestration owner。

## Current Status

- status: completed
- current phase: complete
- current slice: RAG-internal Agents SDK loop implemented and verified; real-provider/public-chat
  E2E remains a separate product-path validation lane
- owner boundary: `packages/rag-agent` + `apps/supervisor-agent-worker`
- downstream boundary: `apps/supervisor-api` remains admission / routing / finalization owner
- data boundary: `packages/retrieval-core` remains retrieval kernel owner
- latest acceptance addendum: 2026-05-06 fixture/contract drift check passed; local
  real-provider public-chat E2E harness is product-path ready but blocked by the current WSL Docker
  backend, not by SDK loop contract failure

## Why This Exists

`agents-sdk-domain-agent-adapter-promotion` 已完成 selected domain-agent ToolSpec adapters：
notice discover、campus-services、academic calendar。那条 workstream 的范围明确排除了 RAG
内部 agentic retrieval，因为当时 `agentic-rag-runtime-rearchitecture` 尚未稳定。

当前 RAG 主路径已经具备 planner-first retrieval、bounded retrieval plan、retrieval observation、
evidence selection、grounded answer synthesis 与 Go finalization seam。继续手写模型 loop、tool
call glue、answer schema glue 与 trace glue 会让 `rag-agent` 内部 runtime 继续膨胀。

本 workstream 的目标是把这部分内部语义执行交给官方 OpenAI Agents SDK，但只作为
`rag-agent` 内部 adapter：

```text
Go supervisor-api
-> AgentRequest(target=rag-agent)
-> Python supervisor-agent-worker
-> rag-agent deterministic scope/version/preflight
-> OpenAI Agents SDK internal loop
-> repo-owned retrieval FunctionTool
-> structured grounded output
-> AgentResponse
-> Go finalization
```

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- expansion plan: `./EXPANSION-PLAN.md`

## Relation To Existing Workstreams

- Builds on completed `agents-sdk-domain-agent-adapter-promotion`.
- Builds on completed `agentic-rag-runtime-rearchitecture` and related RAG retrieval hardening
  workstreams.
- Does not replace deferred `governed-multi-agent-workflow-runtime`.
- Does not reopen `retrieval.query` as an agent-facing ToolSpec.

Fixed split:

- This workstream owns SDK adoption inside `rag-agent`.
- `agents-sdk-domain-agent-adapter-promotion` owns selected structured ToolSpec adapter lanes.
- `governed-multi-agent-workflow-runtime` owns cross-agent multi-step workflow execution.
- canonical / chunk / embedding / retrieval release quality remains owned by canonical retrieval
  workstreams and `packages/retrieval-core`.

## Boundary Notes

- Use official OpenAI Agents SDK `Agent`, `Runner`, `FunctionTool`, structured output, guardrails
  and guarded tool-loop support.
- Keep `retrieval.query` internal to `rag-agent`; do not add it to public ToolSpec or
  `allowed_structured_handoff_tools`.
- SDK function tools may call repo-owned retrieval functions through bounded projections only.
- SDK native tracing remains off by default. The implementation may derive sanitized diagnostics
  from SDK run results, tool execution records or hooks; raw SDK tracing can only be enabled after a
  separate redaction/exporter gate proves it cannot leak prompts, transcripts, raw evidence or
  source bodies.
- Accepted answers require claim-level support, not just source-id presence. Final output must map
  answer claims or list items to returned `source_id + excerpt/span/ref` evidence anchors.
- SDK query rewrite is bounded. The model may select or label deterministic planner query slots; any
  semantic replan must be explicitly budgeted, attributed and unable to widen scope, selector,
  authorization, serving surface or version constraints.
- SDK-native run state, handoff graph, raw provider response and raw trace must not enter
  `packages/contracts`, panel APIs, eval canonical fixtures or workflow trace truth.
- Go `WorkflowPlan`, `AgentRequest`, `AgentResponse` and supervisor finalization remain canonical.

## External Design Inputs

The boundary above intentionally follows the official Agents SDK primitive split:

- Agents are LLMs equipped with instructions and tools.
- Function tools wrap Python functions and expose schema-validated calls.
- Agents-as-tools and handoffs are available delegation mechanisms, but repo handoff ownership stays
  in Go `WorkflowPlan`.
- Guardrails can validate inputs, outputs and custom function-tool calls; repo evidence/authz
  guardrails remain the acceptance owner.
- SDK tracing is enabled by default upstream and can include LLM/tool/handoff/guardrail events, so
  this repo keeps native tracing disabled unless a separate redaction/exporter gate is admitted.

References:

- `https://openai.github.io/openai-agents-python/`
- `https://openai.github.io/openai-agents-python/tools/`
- `https://openai.github.io/openai-agents-python/handoffs/`
- `https://openai.github.io/openai-agents-python/guardrails/`
- `https://openai.github.io/openai-agents-python/tracing/`
