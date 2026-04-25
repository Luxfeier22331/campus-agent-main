# campus-supervisor-core

`packages/supervisor-core` 是 `campus-agent` 当前保留的 private agent dispatch helper。

它不再表达 supervisor coordination owner，也不拥有默认 agent registry。当前只负责消费
Go preplanned `SpecialistRequest`，按 worker 注入的 `AgentDelegate` 调用 agent，并把
`SpecialistResponse` 交回 Python bridge。公共 `SupervisorResponse` finalization 与
response observability projection 已迁到 Go `apps/supervisor-api`。

`SpecialistRequest` / `SpecialistResponse` 是当前 bridge v5 与
`packages/contracts` 中保留的 legacy wire contract 名称；active implementation
命名应使用 agent dispatch / agent handoff，不再把 Python core 描述成 specialist
runtime owner。

## Package Contract

这个 package 只拥有 private semantic worker 内的 agent dispatch 职责：

- 消费 Go `supervisor-api` 在 bridge v5 中给出的 deterministic runtime decisions
- 消费 Go `supervisor-api` 在 bridge v5 中给出的完整 deterministic delegate
  `SpecialistRequest`
- 通过 worker 注入的 `AgentDelegate` 将 Go preplanned `SpecialistRequest` 委派给对应
  agent
- 将 agent 返回的 `SpecialistResponse` 直接交回 Python bridge

这个 package 不拥有：

- HTTP transport、auth 映射或 runtime host 逻辑
- retrieval strategy、evidence 获取或索引访问
- ingestion/data plane 逻辑
- 对象存储、Qdrant、MinIO 或其他基础设施细节

`apps/supervisor-api` 拥有入口 deterministic runtime / policy gate 与
`SpecialistResponse -> SupervisorResponse` finalization；这里不再作为 capability、
scope、query-enabled scope、terminal response、structured tool policy、structured
payload planning 或 public response assembly 的 runtime truth。

## Accepted Current-Design Modules

当前接受的模块拆分如下：

- `routing.py` 已删除；intent eval 默认且唯一使用 Go `supervisor-api`
  runtime-policy runner，bridge 主路径只要求 Go runtime 注入完整 `SpecialistRequest`，
  缺失时 fail-closed。
- `errors.py` 只保留 private agent dispatch error 与 cooperative cancellation error。
- `framing.py` 已删除；Python core 不再构造内部 `SpecialistRequest` envelope。
- `policy.py` 与 `response.py` 已删除；agent 结果后的 public response
  finalization、source projection 与 observability projection 均由 Go
  `supervisor-api` 执行。
- `audit.py` 已删除；execution audit 由 Go `apps/supervisor-api` 的 allowlisted
  runtime audit writer 负责，Python core 不再维护 runtime audit projection helper。
- `dispatcher.py` 只串起 `preplanned contract request -> injected AgentDelegate ->
  contract response` 的 private agent dispatch 流程。
- `context.py`、`validation.py`、`scope_policy.py`、`query_policy.py`、`intent.py` 与
  `tool_policy.py` 已删除；相关 capability/scope/version、query-serving scope、
  runtime intent frame 与 target/tool policy 均由 Go `apps/supervisor-api` 覆盖。

## Current Query Scope

当前查询范围是显式收敛的：

- `rag-agent` 仍是默认 retrieval query-serving agent
- `campus-services-agent` 与 `notice-agent` 现已作为 forward runtime owner package 接入
  worker-side default agent registry，但这只冻结 execution-side owner / adapter /
  protocol seam；不等于产品主路径已经打开这些 capability
- query-serving 是否开放某个 corpus/scope，由 Go `apps/supervisor-api` 读取
  `configs/runtime/query-serving-scopes.v1.json` 后在 bridge 前 fail-closed
- 当前 runtime-profile 已开放 `regulations/student_rules` 与
  `curriculum/curriculum_plan`，以及 `official_web/stable_reference` 的 query-serving；
  `campus_services/*` 继续保持 `offline_preparation`

如果后续要继续增加 agent 或放开新的 query-serving corpus，应先更新架构/决策文档，再调整这里的 contract 描述与实现。

## Boundary With Neighbor Packages

- `apps/supervisor-api` 负责 auth mapping、trace propagation、`SupervisorRequest`
  构造、bridge v5 projection、`SpecialistResponse -> SupervisorResponse`
  finalization 和 HTTP response projection。
- `apps/supervisor-core-worker` 负责装配默认 agent delegate map、RAG prompt executor 与
  structured query HTTP adapter。
- `packages/contracts` 提供 supervisor-facing request 与 supervisor->agent handoff
  schema。
- `packages/rag-agent` 负责 retrieval-oriented agent 逻辑，不由 `supervisor-core` 越级实现。
- `packages/retrieval-core` 只通过 `rag-agent` 间接被消费；`supervisor-core` 不直接依赖它。
- `packages/campus-services-agent` / `packages/notice-agent` 拥有 structured
  runtime capability 的 internal query service protocol 与 thin
  adapter；`supervisor-core` 只调用 worker 注入的 delegate，不直接拥有这些 query
  truth。opened
  structured capability 的 non-stream / lifecycle SSE direct answer path 可由 Go
  `supervisor-api`
  完成，不改变本 package 的 semantic orchestration 边界。

## Verification Focus

与本 package 当前边界直接相关的验证包括：

- `uv run --all-packages python -m unittest
  tests.supervisor.supervisor_core_routing_suite -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.supervisor_core_agent_handoff_suite -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.supervisor_core_prompt_execution_suite -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_runtime_guardrails -q`
- `uv run --all-packages python -m unittest
  tests.api.supervisor_api_bridge_suite -q`
