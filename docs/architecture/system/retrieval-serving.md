---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 execution-control 拥有的文档范围准入、不可变知识 release、候选召回和 grounding
准备。它不负责来源采集、答案生成或个人记忆。

## 文档范围

`configs/runtime/query-serving-targets.v3.json` 是 `document_scope` 到 corpus、逻辑 collection、
server-owned serving config、候选限制和本地路由词的权威映射。当前范围为：

- `student_rules`；
- `institutional_rules`；
- `curriculum`。

范围是领域准入标识，不是模型工具参数、Qdrant alias 或物理 collection 名。execution-control
根据冻结问题选择零个、一个或多个范围；app-api 和浏览器不能选择或缩小范围。

## 消费合同与当前缺口

`knowledge-serving-release.v1` 定义不可变 `release_id`、Qdrant 物理 collection 和 embedding
身份。PostgreSQL `knowledge_serving.current_releases` 是 execution-control 唯一接受的激活指针。

在线运行不解析 Qdrant alias，也不在执行途中重新读取激活状态。采集任务、schema、serving config
或物理 collection 单独存在都不表示范围可用。

当前没有写入这些 release、索引和激活指针的正式生产者，也没有可供准入的发布数据。因此文档
grounding 当前不可用；本节其余内容描述已经实现的消费合同，不代表发布链已经存在。

## 运行准入

execution-control 先形成 `grounding_plan.v1`，再在创建 workflow 前一次性解析并冻结：

- 每个选中 scope 的 corpus、逻辑 collection、`release_id` 和物理 Qdrant collection；
- 完整归一化 serving config、hash 和候选限制；
- 所有路径的 `llm` 模型设置 hash；检索路径额外冻结 `embedding` 模型设置 hash；
- `tool_runtime_fingerprint.v2` 与 Agent 运行限制。

缺少 current release、配置不兼容、配置 hash 不一致或 collection 身份冲突时拒绝准入。整个 run 只消费
该快照，不跟随后续发布或模型设置变更。

准入快照是有界 workflow input，不含凭据、文档正文或 Provider 响应。Provider 凭据只按冻结
kind 在 Activity 内解析，并用准入 hash 做 rotation fence。

## Grounding 流程

```text
冻结查询与所选范围
-> 按 serving instruction 执行一次 embedding
-> 并发查询各准入物理 collection
-> 校验 scope、release、chunk、正文 hash 和 token_count
-> 跨 scope 去重
-> 使用 Qdrant dense+sparse RRF 分数统一排序
-> 范围保底、section 去重并按 grounding_context.v2 的数量和 token 预算裁剪
-> 返回有界 Grounding Activity result
```

Qdrant collection 保存在线检索所需的 chunk 正文、token 数和引用元数据，因此 grounding 不再回
PostgreSQL 读取章节正文。PostgreSQL 仍拥有 release、激活指针和发布审计身份。

每个范围的查询相互独立并发执行；任一范围查询、embedding 或结果校验失败都会使
`grounding.prepare` 失败关闭，不返回部分 grounding，也不回退到旧 release、旧缓存或模型记忆。
`partial` 只表示多范围检索成功完成但部分范围没有合格依据，不表示依赖调用部分成功。
`ready` 只表示全部所选范围都有合格依据；两者都不是答案充分性判断，Primary Agent 仍需按用户
问题逐项确认现有正文能否支持回答。

Qdrant RRF 分数只用于候选排序和预算选择，不是答案正确性的证明，也不是答案置信度。当前实现不调用
外部 reranker；`grounding.rerank_ms` 只是 Activity 内部 timing 投影，不发送到外部观测平台。

## Activity 结果

完整 `grounding_context.v2` 绑定 run、准入 hash、计划 hash、查询 hash、所选范围与覆盖范围。它是有界
Grounding Activity result，由 Temporal history 传给 Agent 和 Finalization；当前合同允许其中包含完整
evidence 正文。Activity 重试会重新执行只读 embedding 与 Qdrant 查询，不从 PostgreSQL 重放旧 context。

普通 step/result 投影只保存 `grounding_context_ref`、payload hash、路由与覆盖状态、候选数、证据数、
token 数，以及 embedding、search、RRF 合并、pack 的耗时；不保存查询或正文。现有
`grounding.rerank_ms` 键固定为零，只表示当前没有外部 reranker。Agent 结果携带相同 context，Finalization 据此
验证 `evidence://`，防止跨 run、跨 release 或伪造引用。

## 当前限制

- 当前没有正式索引生产者和发布数据，文档 grounding 不可用；
- 只查询 `current_releases` 指向的当前发布，不提供历史版本检索；
- 不执行远程模型查询改写、模型 scope 路由或迭代检索；
- 不把 `ready` 当作答案充分性，不把 RRF 分数当作答案置信度；
- official web 不在当前文档范围；
- grounding 不进入 SDK 工具轨迹。

## 相关文档

- `agentic-retrieval.md`
- `data-plane.md`
- `../../data/durable-runtime.md`
