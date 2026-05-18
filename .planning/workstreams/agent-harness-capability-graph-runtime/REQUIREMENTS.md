---
doc_type: requirements
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Requirements: Agent Harness Capability Graph Runtime

## Goal

建立 repo-governed agent harness，使复合校园问题通过 artifact graph 和 registry 组合 agent/tool，
而不是在 planner 中为每个场景硬编码 `multi_step` 分支。

目标是让新增 tool/agent 的接入流程变成：

1. 声明 artifact schema。
1. 声明 producer/consumer owner。
1. 声明 source truth、freshness、grounding、answer eligibility 与 opening gate。
1. 增加 harness-level eval denominator。

然后由 deterministic resolver 从 `CapabilityPlan` 编译 `WorkflowPlan`。

## Primary Requirements

- `configs/runtime/workflow-artifacts.v1.json` is the Phase 1 machine-readable artifact
  ontology. Later phases may promote pieces into existing registries, but must not invent a second
  artifact vocabulary.
- 新增 `CapabilityPlan` 概念，至少表达 capability、required artifacts、constraints、
  answer policy、grounding policy、budget 和 fail-close posture。
- 新增 artifact ontology，冻结第一批 query-time typed artifact：
  - `NoticeContext`
  - `NoticeChangeSet`
  - `ScheduleBaseline`
  - `ServiceStatusFacts`
  - `ServiceGuideFacts`
  - `ContactDirectoryFacts`
  - `AcademicCalendarFacts`
  - `PlaceContext`
  - `EvidenceBundle`
  - `GroundingVerdict`
- 扩展或旁挂 `AgentSpec` / `ToolSpec` registry，使每个 agent/tool 可声明：
  - `produces`
  - `consumes`
  - `required_inputs`
  - `source_truth_owner`
  - `freshness_policy`
  - `answer_eligible`
  - `requires_grounding`
  - `state_changing`
  - `opening_gate`
  - `eval_denominator`
- Resolver 必须根据 registry 生成 executable `WorkflowPlan`，并在 owner 缺失、gate 未开、
  artifact 冲突、预算不足或 source trust 不满足时 fail-closed。
- `WorkflowPlan` 必须显式表达 step dependencies、allowed agents、allowed tools、budget、
  timeout、retry posture、projection kinds 与 finalizer input expectations。
- Step runner 必须校验每个 step 输出能转换为 declared `StepOutputProjection` artifact。
- Finalizer 必须消费 artifact bundle，不直接读取 raw source 或隐式扫描 agent/tool raw output。
- Agents SDK 只能作为 admitted step 内 runtime substrate；不能拥有 global workflow graph、
  public response contract、shared contract schema 或 finalization ownership。
- Eval 必须覆盖 artifact selection、owner correctness、step dependency correctness、
  projection completeness、tool no-call / should-call、fail-close correctness 与 final answer
  artifact usage。

## Initial Migration And Expansion Targets

第一条迁移目标：

```text
selected notice context
-> rag knowledge follow-through
```

迁移目标是行为等价，把现有手写 `multi_step` 转成 `CapabilityPlan + artifact graph` 生成。

第一条扩展目标：

```text
transport schedule baseline
-> notice change set
-> rag grounding verdict
-> supervisor finalization
```

这条能力回答稳定班次基底 + 近期通知 override / exception / evidence grounding 的复合问题。

第二条候选扩展保持后置：

```text
service guide/status/contact
-> place context
-> optional grounding
-> supervisor finalization
```

它需要 `navigation-agent` / place truth 更稳定后再 admission。

## Non-Goals

- 不让 LLM 或 provider SDK 自由选择 repo 全局工具。
- 不把 SDK handoff 图提升为 canonical workflow truth。
- 不重开 `campus_notice_get` 为 top-level provider/SDK tool。
- 不把 structured campus-services lookup 伪装成 RAG retrieval step。
- 不引入 general web browse fallback、remote MCP answer-bearing fallback、raw SQL 或 raw object
  store query-time tool。
- 不实现预约、提交、支付、审批、工单或任何 state-changing workflow。
- 不把 RAG historical/as-of/compare 内部 multi-step retrieval 强行提升到 supervisor-level
  workflow。
- 不修改 ingestion/source-truth/chunk/embedding/index build path，除非 artifact contract 明确需要
  新的 query-time read model。

## Success Criteria

- `workflow-artifacts.v1.json` remains aligned with Go execution projection support, shared
  execution contract enum, AgentSpec context projection kinds and raw-key guard expectations.
- Planner 可以产出 `CapabilityPlan`，至少覆盖当前 selected-notice follow-through 行为。
- Resolver 可以把 `CapabilityPlan` 编译成现有 `WorkflowPlan`，且失败原因稳定可测。
- Registry 明确第一批 artifact 的 producer/consumer、source truth 与 answer eligibility。
- 当前 selected-notice follow-through 不再依赖 planner 场景特判生成固定 step list。
- Transport baseline + notice override + grounding 的 expansion plan 有 readiness/eval gate，
  不能通过新增 if-else 绕过 harness。
- Harness trace 可以证明 expected artifacts、selected owners、step dependencies、projection
  completeness 与 final answer usage。
- Go focused tests、Python focused tests、contract/eval fixtures、docs lint 与 `git diff --check`
  通过。

## Stable References

- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/domains/navigation/architecture.md`
- `configs/runtime/agents.v1.json`
- `configs/runtime/tools.v1.json`
- `apps/supervisor-api/internal/structuredplanning/`
- `apps/supervisor-api/internal/execution/`
- `apps/supervisor-api/internal/runtimepolicy/`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/`
- `packages/contracts/src/campus_contracts/`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
