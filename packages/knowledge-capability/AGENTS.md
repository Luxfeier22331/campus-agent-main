# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/knowledge-capability` 的局部规则。

## Role

这个目录承载 knowledge / RAG capability 的局部语义实现边界。

- 接收来自 offline / eval / tooling caller 的稳定 `CapabilityRequest`，而不是继续暴露旧
  prototype tool 风格接口；不得把 `apps/supervisor-agent-worker` 重新解释成 online serving 入口
- 负责 retrieval 导向的 `query rewriting`、`retrieval strategy selection`、`evidence
  collection`、`evidence normalization`、`confidence` 返回
- 返回 `CapabilityResponse` 的 rag 分支，而不是把底层 retrieval 结果原样泄漏出去
- 当前默认 query-serving knowledge capability 仍是 `knowledge`

当前 bootstrap 入口是 `src/campus_knowledge_capability/service.py` 中的
`delegate_to_knowledge_capability(...)`。优先沿着这个 service 边界演进，不要把 capability 逻辑散落到别处。

当前内部 facade 边界：

- `service.py` 保持 capability service facade
- scope-specific logic 放在 `service_scope_curriculum.py`、`service_scope_handbook.py`、
  `service_scope_plans.py`
- direct answer composition 放在 `answering_generic.py`、
  `answering_procedure.py`、`answering_support.py`
- grounding validation 的 result、trust policy、support policy、
  source-trust summary 分文件维护

## Source Of Truth

修改本目录前，优先阅读：

- `../../AGENTS.md`
- `../../docs/architecture/target-architecture.md`
- `../../docs/architecture/system/data-plane-architecture.md`
- `../../docs/architecture/system/retrieval-serving-architecture.md`
- `../../docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `../../docs/reference/runtime-serving-and-index-terms.md`
- `../../docs/architecture/target-architecture.md`
- `src/campus_knowledge_capability/service.py`
- `README.md`

## Owns

- knowledge capability 层的 query/answer/confidence 语义
- clarification / no answer / error 映射
- 把 retrieval 结果整理成稳定的 capability contract
- 返回带 evidence 的响应，并保持 source locator 可回链到 document registry 语义

## Does Not Own

- `Qdrant`、`LlamaIndex`、对象存储、registry 的底层接入细节
- index 构建与 ingestion data plane 逻辑
- 顶层会话编排、跨 capability 路由、最终响应组装
- 旧 `/api/search`、`/api/answer` 的兼容层

边界规则：

- 如果一个改动需要修改 index/object store/registry 语义，优先去 `packages/retrieval-core` 或
  `packages/ingestion-core`
- 不要把 `Agno`、retrieval backend 或对象存储 SDK 类型泄漏进 `packages/contracts`
- `confidence` 逻辑属于 knowledge capability 层，不是 retrieval backend 原始输出的直接透传

## Current Serving Constraints

- 当前 query-serving scope 由 collection runtime profile 决定；默认开放
  `regulations/student_rules`、`regulations/institutional_rules`、
  `curriculum/curriculum_plan` 与 `official_web/stable_reference`
- 已冻结但未放开的 corpus 应通过显式 fail-closed 路径返回，而不是在 capability 内静默扩面
- 不要在此目录自行维护 query-enabled scope truth；范围判断以 supervisor 与 runtime profile 为准
- 不要在此目录提前引入多 corpus fan-out 或并行检索逻辑
- 不要提前引入多 retrieval backend 并行
- 不要把 agent 写成 retrieval backend 的薄壳；这里负责 contract 化和结果整形
- 不要把已经拆出的 scope、answering、grounding validation 大块逻辑放回 facade

## Contract Over Compatibility

- 不要把 agent 写成 retrieval backend 的薄壳或兼容层
- 如果 retrieval 输出形状不适合 capability contract，优先修 contract 化边界，不要在外面反复打补丁
- 不要为了兼容旧接口继续保留 `/api/search`、`/api/answer` 风格路径
- 如果一个问题暴露的是 agent/retrieval 分层错误，优先修边界，不要新增中间适配层

## Answering And Verification

- 涉及“当前最佳 RAG 实践”“官方当前 agent/RAG 建议”“最新推荐模式”时，先联网核对官方资料
- 不要把通用行业观点写成仓库硬规则
- 如果证据不足，就保守表述并明确不确定性
- 对纯判断型回答，不默认追加下一步实现建议

## Subagent Guidance

这个目录鼓励把工作按层切分，但不要多人同时改同一 service 与共享 contract。

- 一个被委派的子任务只处理 `service` / agent response shaping
- 一个被委派的子任务只处理 `retrieval-core` 侧 evidence contract 对接
- 一个被委派的子任务只处理 tests / eval baseline
- 关键接口、status/confidence 枚举、evidence 形状变更由主代理统一收口
- 不要让多个并行子任务同时修改 `src/campus_knowledge_capability/service.py`

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m unittest \
  tests.agent.knowledge_capability_service_structure_suite \
  tests.agent.test_knowledge_capability -q
uv run --all-packages python -m unittest discover -s tests -t .
```
