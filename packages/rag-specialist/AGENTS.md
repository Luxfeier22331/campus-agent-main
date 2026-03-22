# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/rag-specialist` 的局部规则。

## Role

这个目录承载 `RAG specialist` 的局部实现边界。

- 接收来自 `supervisor-core` 的稳定 handoff，而不是继续暴露旧 `campusRAG` tool 风格接口
- 负责 retrieval 导向的 `query rewriting`、`retrieval strategy selection`、`evidence collection`、`evidence normalization`、`confidence` 返回
- 返回 `DelegateToRagAgentResponse`，而不是把底层 retrieval 结果原样泄漏出去
- 第一阶段只服务 `student_handbook`

当前 bootstrap 入口是 `src/campus_rag_specialist/service.py` 中的 `delegate_to_rag_agent(...)`。优先沿着这个 service 边界演进，不要把 specialist 逻辑散落到别处。

## Source Of Truth

修改本目录前，优先阅读：

- `../../AGENTS.md`
- `../../docs/architecture/long-term-architecture.md`
- `../../docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `../../docs/decisions/adr-0001-phase1-architecture.md`
- `../../docs/plans/agentic-rag-foundation.md`
- `src/campus_rag_specialist/service.py`
- `README.md`

## Owns

- specialist 层的 query/answer/confidence 语义
- clarification / no answer / error 映射
- 把 retrieval 结果整理成稳定的 specialist contract
- 返回带 evidence 的响应，并保持 source locator 可回链到 document registry 语义

## Does Not Own

- `Qdrant`、`LlamaIndex`、对象存储、registry 的底层接入细节
- index 构建与 ingestion data plane 逻辑
- 顶层会话编排、跨 specialist 路由、最终响应组装
- 旧 `/api/search`、`/api/answer` 的兼容层

边界规则：

- 如果一个改动需要修改 index/object store/registry 语义，优先去 `packages/retrieval-core` 或 `packages/ingestion-core`
- 不要把 `Agno`、retrieval backend 或对象存储 SDK 类型泄漏进 `packages/contracts`
- `confidence` 逻辑属于 specialist 层，不是 retrieval backend 原始输出的直接透传

## Phase-1 Constraints

- 第一阶段只支持 `student_handbook`
- 不要在此目录提前引入多 corpus 分支逻辑
- 不要提前引入多 retrieval backend 并行
- 不要把 specialist 写成 retrieval backend 的薄壳；这里负责 contract 化和结果整形

## Contract Over Compatibility

- 不要把 specialist 写成 retrieval backend 的薄壳或兼容层
- 如果 retrieval 输出形状不适合 specialist contract，优先修 contract 化边界，不要在外面反复打补丁
- 不要为了兼容旧接口继续保留 `/api/search`、`/api/answer` 风格路径
- 如果一个问题暴露的是 specialist/retrieval 分层错误，优先修边界，不要新增中间适配层

## Answering And Verification

- 涉及“当前最佳 RAG 实践”“官方当前 agent/RAG 建议”“最新推荐模式”时，先联网核对官方资料
- 不要把通用行业观点写成仓库硬规则
- 如果证据不足，就保守表述并明确不确定性
- 对纯判断型回答，不默认追加下一步实现建议

## Subagent Guidance

这个目录鼓励把工作按层切分，但不要多人同时改同一 service 与共享 contract。

- 一个被委派的子任务只处理 `service` / specialist response shaping
- 一个被委派的子任务只处理 `retrieval-core` 侧 evidence contract 对接
- 一个被委派的子任务只处理 tests / eval baseline
- 关键接口、status/confidence 枚举、evidence 形状变更由主代理统一收口
- 不要让多个并行子任务同时修改 `src/campus_rag_specialist/service.py`

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q
uv run --all-packages python -m unittest discover -s tests -t .
```
