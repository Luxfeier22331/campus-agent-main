# campus-supervisor-core

`packages/supervisor-core` 是 `campus-agent` 在 phase-1 中已经接受的 supervisor coordination 边界。

它不再被定义成“未来再补的 bootstrap 壳”，而是当前查询主链路中负责 request framing、routing、policy、response shaping 和 audit projection 的稳定 package。

## Package Contract

这个 package 只拥有 supervisor 的编排职责：

- 将共享 `SpecialistRequest` 投影为 supervisor 可决策的内部上下文
- 对 phase-1 请求执行显式 routing decision
- 通过共享 contract 委派给对应 specialist
- 对 specialist 返回结果执行 finalization policy
- 组装统一的 `SpecialistResponse`
- 投影最小审计字段

这个 package 不拥有：

- HTTP transport、auth 映射或 runtime host 逻辑
- retrieval strategy、evidence 获取或索引访问
- ingestion/data plane 逻辑
- 对象存储、Qdrant、MinIO 或其他基础设施细节

`apps/supervisor-api` 只能把外部请求映射进这里，不能把 routing、policy 或 response assembly 回灌到 API 壳。

## Accepted Current-Design Modules

当前接受的模块拆分如下：

- `context.py`
  将 `SpecialistRequest` 投影为 `SupervisorRequestContext`，承接 request framing 所需的最小字段。
- `routing.py`
  承担 phase-1 routing decision，当前保持 `student_handbook -> rag-specialist` 为 query-serving 主线，同时允许显式 `availability-specialist` 请求走并行 capability 路径。
- `policy.py`
  承担 specialist 结果后的 finalization policy，稳定处理 `completed`、`needs_clarification`、`no_answer` 和 `error`。
- `response.py`
  承担 response shaping 与 source projection，输出统一的 `SpecialistResponse`。
- `audit.py`
  承担 audit projection，只输出最小稳定审计字段。
- `agent.py`
  串起 `context -> routing -> specialist delegation -> policy -> response assembly` 的主流程。

## Phase-1 Scope

phase-1 的查询范围是显式收敛的：

- `rag-specialist` 仍是唯一默认 query-serving specialist
- `availability-specialist` 作为显式并行 capability 已存在，但不扩张 handbook 主线 transport surface
- 只允许一个默认 query-serving corpus：`student_handbook`
- 不允许在 `supervisor-core` 内静默放开其他 corpus
- `curriculum_plan` 等其他 data-plane corpus 在本阶段仍然不参与 query-serving

如果后续要继续增加 specialist 或放开新的 query-serving corpus，应先更新架构/决策文档，再调整这里的 contract 描述与实现。

## Boundary With Neighbor Packages

- `apps/supervisor-api`
  负责 auth mapping、trace propagation、rag-default `SpecialistRequest` 构造和 HTTP response projection。
- `packages/contracts`
  提供 supervisor 与 specialist 之间唯一共享的 handoff schema。
- `packages/rag-specialist`
  负责 retrieval-oriented specialist 逻辑，不由 `supervisor-core` 越级实现。
- `packages/retrieval-core`
  只通过 `rag-specialist` 间接被消费；`supervisor-core` 不直接依赖它。

## Verification Focus

与本 package 当前边界直接相关的验证包括：

- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py -q`
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_routing.py -q`
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_policy.py -q`
- `uv run --all-packages python -m pytest tests/api/test_supervisor_api.py -q`
