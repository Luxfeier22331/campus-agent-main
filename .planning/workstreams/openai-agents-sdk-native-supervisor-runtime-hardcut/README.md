---
doc_type: index
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Workstream: OpenAI Agents SDK Native Supervisor Runtime Hardcut

这是 `openai-agents-sdk-native-supervisor-runtime-hardcut` 的 native workstream 入口。

本 workstream 负责把 Python provider-facing semantic execution runtime 从 repo 自研
runner / adapter / rollout shell 硬切到官方 OpenAI Agents SDK primitives。目标不是再扩一层
SDK pilot，也不是保留 shadow / fallback / candidate / direct 兼容态；目标是让 Python worker
与 domain-agent 的模型回合、function tool loop、guardrail 和 handoff substrate 只剩一种长期形态：

```text
Go supervisor-api
-> repo-owned AgentRequest / WorkflowPlan / ToolSpec admission
-> Python supervisor-agent-worker SDK-native runtime
-> package-owned domain agents and repo-owned tools
-> bounded StepOutputProjection / AgentResponse
-> Go finalization
```

## Current Status

- status: `active`
- current phase: `Phase 8 - Residual Deletion And Drift Guards`
- current slice: native runtime + RAG thin wrapper are in place; old custom runner shell and
  rollout smoke residue have been deleted; focused verification is green
- owner boundary: `apps/supervisor-agent-worker` + `packages/rag-agent` +
  domain-agent packages + `packages/contracts` + `configs/runtime/agents.v1.json` +
  `configs/runtime/tools.v1.json` + supervisor / agent / eval tests

## Latest Progress

2026-05-08:

- Phase 1 completed:
  - `CURRENT-DEBT-INVENTORY.md`
  - `SDK-PRIMITIVE-MAPPING.md`
- Phase 2 completed:
  - `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py`
  - `tests/supervisor/openai_agents_runtime_suite.py`
- Current implementation is now the native SDK runtime substrate plus the RAG thin wrapper path.
  Old production `AgentsSdkRunner` / `AgentsSdkRunRequest` / `AgentsSdkRunResult` shell has been
  deleted.

## Why This Workstream Exists

此前已完成的 `sdk-only-domain-agent-execution-hardcut` 解决的是 structured
domain-agent tool 的 direct adapter / SDK adapter 双轨问题。但当前 repo 仍有更上层的
runtime 债务：

- worker 内仍有 repo-owned `AgentsSdkRunner` / `AgentsSdkRunRequest` /
  `AgentsSdkRunResult` shell，实际继续模拟 SDK agent loop。
- RAG SDK lane 仍保留 `closed` / `shadow` / `candidate` / `default_on` rollout 语义。
- `rag-agent` 主答复路径仍以自研 pipeline 为 default，SDK 只是后置 synthesis lane。
- `single_handoff`、agent-internal tools、RAG internal retrieval tool、multi-step workflow
- Structured and RAG execution now both use the native runtime substrate; remaining work is
  residue deletion, drift guards, eval acceptance and docs closeout.

## Official SDK Basis

本 workstream 采用官方 OpenAI Agents SDK 当前 primitives 作为实现基底：

- `Agent` + `Runner` 承接 model turn、tool invocation loop、guardrails、handoffs 与
  sessions。
- Function tools 用于 repo-owned internal query / retrieval / projection execution。
- Handoffs 用于 specialist ownership transfer；manager-style specialist calls 用
  agents-as-tools，而不是让 agent 自由 peer mesh。
- SDK tracing 可以记录 LLM generation、function tool、handoff 与 guardrail span，但 repo
  只消费 sanitized projection，不保存 raw provider trace。
- 官方文档允许同一应用按路径混用 SDK 和 Responses API；本 workstream 的 hardcut 是本 repo
  对 Python semantic runtime 的架构收口决定，不是把 SDK 提升为 Go supervisor 或 data-plane
  owner。

参考：

- <https://openai.github.io/openai-agents-python/quickstart/>
- <https://openai.github.io/openai-agents-python/agents/>
- <https://openai.github.io/openai-agents-python/tools/>
- <https://openai.github.io/openai-agents-python/handoffs/>
- <https://openai.github.io/openai-agents-python/tracing/>

## Hard-Cut Rules

- 不保留 direct fallback。
- 不保留 SDK shadow / candidate / fallback rollout。
- 不保留 repo-owned provider loop 作为生产等价 runtime。
- 不新增 compatibility flag 让旧自研 pipeline 继续回答同一类请求。
- 不让 SDK 接管 Go-owned admission、WorkflowPlan、ToolSpec、budget、authz、runtime
  policy、source-trust 或 finalization。
- 不把 SDK native type、raw trace、tool raw output、provider response id 或 SDK run
  graph 写进 `packages/contracts`、panel、eval canonical asset 或 public response。
- 不把 hosted web/search/code/shell/computer/MCP tool 直接接入 campus query-time path。
  查询工具必须是 repo-owned bounded function tool。
- 不让 SDK 接管 deterministic retrieval planning、retrieval execution、evidence selection、
  source-trust、runtime profile 或 release/alias ownership。

## Target Shape

目标态固定为：

- Go `supervisor-api` 是 deterministic manager：
  - owns capability routing, lane/scope/version gate, ToolSpec admission, WorkflowPlan,
    allowed agents, allowed tools, step budget and finalization
- Python `supervisor-agent-worker` 是 SDK-native semantic runtime：
  - compiles repo-owned AgentSpec / ToolSpec / WorkflowPlan into SDK `Agent`, `FunctionTool`,
    handoff or agents-as-tools execution
  - invokes official SDK `Runner`
  - maps SDK result into repo-owned `AgentResponse` / `StepOutputProjection`
- domain packages own semantic agents and repo-owned tools:
  - `rag-agent` owns deterministic retrieval planning/evidence selection and SDK-native grounded
    synthesis contract
  - `campus-services-agent`, `notice-agent`, `navigation-agent` own domain-specific
    read-only tool execution and bounded result projection
- `packages/contracts` remains SDK-free:
  - only stable DTOs, schemas and sanitized result projections enter contracts

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- planning review: `./PLANNING-REVIEW.md`

## Relation To Existing Workstreams

- Builds on completed `sdk-only-domain-agent-execution-hardcut`.
- Builds on completed `execution-tool-calling-governance`.
- Builds on completed `rag-agent-internal-agents-sdk-loop`.
- Builds on completed `supervisor-multi-agent-runtime-contract-hardening`.
- Supersedes further single-surface SDK expansion as an implementation strategy only for Python
  provider-facing semantic runtime hardcut.
- Does not reopen completed RAG / structured SDK workstreams; it consumes their lessons and closes
  the remaining runtime residue at the worker/package boundary.
- Does not reopen Go runtime migration, data-plane ingestion, retrieval backend migration or
  product auth/session ownership.

## Reopen Rule

After completion, reopen only if:

- Python semantic execution reintroduces repo-owned provider loop as production runtime;
- RAG answer path regains non-SDK fallback / shadow / candidate execution for query-enabled
  surfaces;
- structured or agent-internal tools bypass SDK-native `FunctionTool` admission;
- Go-owned WorkflowPlan / ToolSpec admission is bypassed by SDK agent routing;
- SDK raw trace, raw tool output or native type leaks into contracts, panel, eval canonical assets
  or public response; or
- official SDK API changes require repo-wide runtime adaptation.
