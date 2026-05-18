---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Workstream: Agent Harness Capability Graph Runtime

这是 `agent-harness-capability-graph-runtime` 的 native workstream 入口。

本 workstream 负责把当前 repo 的 `multi_step` 从少量手写场景推进为
repo-governed agent harness：planner 先产出 `CapabilityPlan`，harness 再根据 artifact
graph、`AgentSpec`、`ToolSpec`、opening gate 与 policy 编译成可执行 `WorkflowPlan`。

目标不是让 LLM 或 OpenAI Agents SDK 自由选择全局工具；目标是减少场景 if-else，让新增
tool/agent 通过 registry 声明 `produces / consumes / requires / answer_eligible` 等能力，
再由 deterministic resolver 生成 bounded workflow。

## Current Status

- status: `completed`
- completed phase: `Phase 9 closeout completed`
- active implementation: none
- current slice: artifact ontology, capability graph registry bindings, internal
  `CapabilityPlan`, resolver-backed `WorkflowPlan`, runner-level artifact completeness validation,
  Go->Python expected-artifact contract alignment, selected-notice capability-only migration and
  trace-level final answer artifact usage summary are complete; the former transport expansion
  follow-up now lives in `transport-notice-override-harness-admission`
- migrated path: selected notice context + knowledge follow-through
- follow-up moved out: transport schedule baseline + notice override + grounding

## Why This Exists

在这条 workstream 启动时，repo 已有：

- Go `supervisor-api` deterministic admission、policy gate、allowed agents/tools 与 finalization
- `AgentSpec` / `ToolSpec` registry
- `WorkflowRun`、step-level trace、`StepOutputProjection` 与 bounded provenance
- Agents SDK default-on adapter for selected read-only domain-agent tools
- 首条 governed multi-step pilot 与 `selected notice -> rag follow-through`

当时仍有这些结构性缺口：

- planner 仍倾向直接输出固定 step list
- step 组合缺少统一 artifact graph
- `multi_step` 场景 admission 与工具/agent 能力声明没有统一 resolver
- eval 仍偏 tool-level 或 scenario-level，缺少 artifact-level harness denominator

这导致每新增一个复合能力都容易回到“为该场景写一段 planner 特判”。本 workstream 的目标是把这类
特判下沉为 capability/artifact contract，而不是让场景逻辑继续扩散。

## Target Shape

长期目标固定为：

```text
app-api
-> Go supervisor-api admission / policy / capability selection
-> CapabilityPlan(required_artifacts, constraints, answer_policy)
-> Artifact registry + AgentSpec + ToolSpec resolver
-> WorkflowPlan(steps, dependencies, budgets, allowed agents/tools)
-> WorkflowRun step runner
-> typed StepOutputProjection artifact bundle
-> Go finalizer
-> public response
```

OpenAI Agents SDK 可以作为 admitted step 内部 runtime substrate：

- SDK 可执行 step-local tools、guardrails、structured output 与 trace
- SDK 不拥有 global workflow graph
- SDK-native trace、session、handoff、tool schema 与 raw result 不进入 shared contract、
  panel、eval canonical truth 或 public response

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- readiness matrix: `./READINESS-MATRIX.md`
- state: `./STATE.md`
- phase 0 review: `./CURRENT-TRUTH-AND-DESIGN-REVIEW.md`
- phase 1 ontology: `./ARTIFACT-ONTOLOGY.md`
- phase 2 capability graph: `./CAPABILITY-GRAPH.md`
- gap ledger: `./GAP-LEDGER.md`
- remaining phase review: `./PLANNING-REVIEW.md`
- phase plans: `./phases/*/PLAN.md`

## Relation To Existing Workstreams

- Builds on completed `execution-tool-calling-governance`.
- Builds on completed `agents-sdk-domain-agent-adapter-promotion`.
- Builds on completed `governed-multi-agent-workflow-runtime`.
- Builds on completed `supervisor-multi-agent-runtime-contract-hardening`.
- Does not replace `rag-agent-internal-agents-sdk-loop`; RAG-internal planning stays inside
  `rag-agent`.
- Does not reopen `repo-wide-agent-harness-rollout`; that workstream was about Codex/GSD execution
  harness, not product runtime agent harness.

Fixed split:

- This workstream owns `CapabilityPlan -> artifact graph -> WorkflowPlan` runtime design and
  implementation.
- `execution-tool-calling-governance` owns tool registry and provider/tool-call lifecycle.
- `agents-sdk-domain-agent-adapter-promotion` owns SDK adapter posture for selected step-local tools.
- `governed-multi-agent-workflow-runtime` remains completed pilot evidence and trace precedent.
- RAG historical/as-of/compare multi-step retrieval remains `rag-agent` internal unless explicitly
  promoted into supervisor-level artifact graph.

## Boundary Notes

- Do not give LLM or SDK global tool-selection authority.
- Do not make `campus_notice_get` a top-level provider/SDK tool again.
- Do not use RAG as fallback for structured campus services gaps.
- Do not expose raw source HTML, raw OCR dumps, raw SQL rows, object store locators, provider traces
  or unbounded snippets as workflow artifacts.
- Do not admit state-changing actions. Booking, submission, payment, ticket creation, approval or
  rollback require a separate approval / HITL / audit workstream.
- Do not add new public serving surface merely because an artifact producer exists.

## Reopen Rule

Reopen only if `CapabilityPlan -> resolver -> WorkflowPlan` runtime truth regresses, selected-notice
multi-step migration drifts back to planner-baked fixed-step logic, workflow trace no longer proves
bounded final answer artifact usage, or a new admitted supervisor-level composite capability needs
to extend the generic harness runtime rather than opening through a dedicated follow-up line.

## External Design Inputs

- OpenAI Agents SDK agents:
  `https://openai.github.io/openai-agents-python/agents/`
- OpenAI Agents orchestration:
  `https://developers.openai.com/api/docs/guides/agents/orchestration`
- OpenAI Agents SDK guardrails:
  `https://openai.github.io/openai-agents-python/guardrails/`
- OpenAI Agents SDK tracing:
  `https://openai.github.io/openai-agents-python/tracing/`
- OpenAI agent evals:
  `https://developers.openai.com/api/docs/guides/agent-evals`
- LangGraph durable execution reference:
  `https://docs.langchain.com/oss/python/langgraph/durable-execution`
- Anthropic agent workflow patterns:
  `https://www.anthropic.com/engineering/building-effective-agents`
