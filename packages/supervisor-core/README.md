# campus-supervisor-core

`packages/supervisor-core` 是 `campus-agent` 当前已经接受的 supervisor coordination 边界。

它不再被定义成“未来再补的 bootstrap 壳”，而是当前查询主链路中负责 request framing、routing、policy、response
shaping 和 audit projection 的稳定 package。

## Package Contract

这个 package 只拥有 supervisor 的编排职责：

- 将共享 `SupervisorRequest` 投影为 supervisor 可决策的内部上下文
- 消费 Go `supervisor-api` 在 bridge v2 中给出的 deterministic runtime decisions
- 对非 bridge 单元测试 / harness 保留 semantic routing fallback
- 在内部构造 `SpecialistRequest` 并委派给对应 agent
- 对 agent 返回结果执行 finalization policy
- 组装统一的 `SpecialistResponse`
- 投影最小审计字段

这个 package 不拥有：

- HTTP transport、auth 映射或 runtime host 逻辑
- retrieval strategy、evidence 获取或索引访问
- ingestion/data plane 逻辑
- 对象存储、Qdrant、MinIO 或其他基础设施细节

`apps/supervisor-api` 拥有入口 deterministic runtime / policy gate；这里不再作为
capability、scope、query-enabled scope 或 structured payload planning 的 runtime truth。

## Accepted Current-Design Modules

当前接受的模块拆分如下：

- `context.py` 将 `SupervisorRequest` 投影为 `SupervisorRequestContext`，承接 request
  framing 所需的最小字段。
- `validation.py` 对 Go 已投影的 capability 做 trust-but-verify，缺失时 fail-closed。
- `query_policy.py` 仅保留非 bridge fallback / 测试辅助；Go
  `apps/supervisor-api` 的 `runtimepolicy` 是 query-enabled scope admission owner。
- `routing.py` 保留 semantic routing fallback；bridge 主路径优先使用 Go runtime decision
  注入的 `RoutingDecision`。
- `errors.py` 提供 supervisor 侧稳定错误分类，供 API shell 做结构化 HTTP 映射。
- `framing.py` 在 routing 决定后构造内部 `SpecialistRequest`，把 external request boundary
  和 internal handoff boundary 分开。
- `policy.py` 承担 agent 结果后的 finalization policy，稳定处理
  `completed`、`needs_clarification`、`no_answer` 和 `error`。
- `response.py` 承担 response shaping 与 source projection，输出统一的
  `SpecialistResponse`。
- `audit.py` 承担 audit projection，只输出最小稳定审计字段。
- `agent.py` 串起 `context -> routing -> agent delegation -> policy -> response
  assembly` 的主流程。

## Current Query Scope

当前查询范围是显式收敛的：

- `rag-agent` 仍是默认 retrieval query-serving agent
- `campus-services-agent` 与 `notice-agent` 现已作为 forward runtime owner package 接入
  default delegate map，但这只冻结 execution-side owner / adapter / protocol
  seam；不等于产品主路径已经打开这些 capability
- query-serving 是否开放某个 corpus/scope，由 Go `apps/supervisor-api` 读取
  `configs/runtime/query-serving-scopes.v1.json` 后在 bridge 前 fail-closed
- 当前 runtime-profile 已开放 `regulations/student_rules` 与
  `curriculum/curriculum_plan`，以及 `official_web/stable_reference` 的 query-serving；
  `campus_services/*` 继续保持 `offline_preparation`

如果后续要继续增加 agent 或放开新的 query-serving corpus，应先更新架构/决策文档，再调整这里的 contract 描述与实现。

## Boundary With Neighbor Packages

- `apps/supervisor-api` 负责 auth mapping、trace propagation、`SupervisorRequest`
  构造和 HTTP response projection。
- `packages/contracts` 提供 supervisor-facing request 与 supervisor->agent handoff
  schema。
- `packages/rag-agent` 负责 retrieval-oriented agent 逻辑，不由 `supervisor-core` 越级实现。
- `packages/retrieval-core` 只通过 `rag-agent` 间接被消费；`supervisor-core` 不直接依赖它。
- `packages/campus-services-agent` / `packages/notice-agent` 拥有 structured
  runtime capability 的 internal query service protocol 与 thin
  adapter；`supervisor-core` 只委派，不直接拥有这些 query truth。

## Verification Focus

与本 package 当前边界直接相关的验证包括：

- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_core -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_routing -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_validation -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_query_policy -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_runtime_guardrails -q`
- `uv run --all-packages python -m unittest
  tests.supervisor.test_supervisor_policy -q`
- `uv run --all-packages python -m unittest tests.api.test_supervisor_api -q`
