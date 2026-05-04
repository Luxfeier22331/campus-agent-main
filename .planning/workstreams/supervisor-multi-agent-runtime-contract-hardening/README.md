---
doc_type: index
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Supervisor Multi-Agent Runtime Contract Hardening

这是 `supervisor-multi-agent-runtime-contract-hardening` 的 native workstream 入口。

本 workstream 负责把当前 supervisor-led multi-agent target 从架构约束推进到可实施的
repo-owned runtime contract：`AgentSpec` registry、agent invocation graph、context
projection policy、handoff lifecycle、tool/result provenance、workflow trace eval 与
observability。

它不负责引入某个 agent framework，也不把 Agents SDK、LangGraph、MCP、Codex CLI app-server
或 provider-native trace 提升为 canonical architecture truth。这些外部 runtime 只作为设计参考。

## Current Status

- status: active
- current phase: Phase 0 planning admission
- current slice: architecture docs updated; implementation plan ready for Phase 1
- product posture: no runtime behavior changed yet
- primary owner boundary: `apps/supervisor-api` + `apps/supervisor-agent-worker` +
  `packages/contracts` + `packages/evals`

## Why This Exists

当前 repo 已接受 `supervisor-led governed multi-agent`，并已有 `WorkflowPlan`、
`WorkflowRunStore`、`workflow_trace_summary`、ToolSpec registry、domain-agent package
boundaries 与 campus-services/notice/rag/navigation family split。

剩余问题是 runtime contract 还不够硬：

- 新增 agent 仍可能退化成 planner / delegate map 中的字符串 target。
- subagent / domain-agent invocation graph 还没有稳定 projection。
- cross-agent context projection 规则还没有成为可验证 schema。
- tool output provenance、resource refs 与 finalizer/display policy 还没有统一到
  multi-agent contract。
- eval 需要从 answer quality 继续扩到 handoff、context、tool、finalization correctness。

## Target Shape

长期 canonical lifecycle 固定为：

```text
Turn
-> WorkflowRun
-> AgentInvocation
-> ToolCall / DeterministicQueryFunction
-> EvidenceRef / StepOutputProjection
-> Supervisor Finalization
```

默认协作模式固定为 manager-style：

```text
Go supervisor-api WorkflowPlan
-> bounded specialist agent calls
-> typed step output projections
-> Go supervisor finalization
```

explicit specialist handoff 只在下一轮回复 ownership 必须转给 specialist 时使用。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 不把 domain agents 建成 peer-to-peer autonomous swarm。
- 不把 `rag-agent` 恢复成所有校园请求的默认 fallback。
- 不把 SDK-native graph、raw provider trace、raw model output 或 MCP tool result 直接写入
  `packages/contracts`、panel、eval 或 workflow trace。
- 不把 raw OCR、raw notice body、raw source HTML、object-store bytes 或 raw SQL 暴露成
  query-time agent context/tool output。
- 不打开 state-changing tool；未来若进入申请、预约、提交、支付或工单，另开 approval /
  HITL / audit / rollback / eval workstream。

## External Design Inputs

- OpenAI Agents SDK:
  `https://developers.openai.com/api/docs/guides/agents`
- OpenAI Agents SDK orchestration:
  `https://developers.openai.com/api/docs/guides/agents/orchestration`
- OpenAI Agents SDK tracing:
  `https://openai.github.io/openai-agents-python/tracing/`
- MCP tools/resource links:
  `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`
- LangGraph multi-agent handoffs:
  `https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs`

