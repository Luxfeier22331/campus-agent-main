---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 服务术语

## 边界

本文统一文档、检索、发布和 Agent 运行中的名称。实现状态仍以注册表、合同和代码为准。

## 产品与数据

### 阅读器固定链接

面向用户的稳定文档 URL，例如 `/docs/:corpus/:collection/:docSlug`。链接中不包含分块标识、
Qdrant collection 或对象存储位置。

### 来源通道

一类来源的采集适配器和来源记录边界。一个来源通道可以向多个语料域或集合提供资料。

### 语料域

`corpus` 表示一类机构知识，例如 `regulations` 或 `curriculum`。

### 集合

语料域内规范文档和索引的所有权单元，例如 `regulations/student_rules`。集合名不是模型可选择的
工具参数。

### 文档范围

`document_scope` 是在线 grounding 的领域准入范围，例如 `student_rules`。范围注册表把它映射到
语料域、逻辑集合和服务端检索配置。范围、语料域、逻辑集合和 Qdrant 物理集合不是同一个概念。

### 工具读取模型

结构化工具使用的类型化读取模型，不经过文档 RAG。当前注册的机构工具只有
`transport_schedule_lookup`，并且处于关闭状态。

## Agent 与 Grounding

### 模型可见工具

当前运行中通过 `tools.v6.json` 和本轮授权向 Primary Agent 暴露的函数工具。知识检索不是模型
工具。

### Grounding Context

`grounding_context.v2` 是 execution-control 在模型调用前准备的、绑定单个 run 和冻结 grounding
plan 的依据合同。它以 `not_required`、`empty`、`partial` 或 `ready` 区分无需检索、无依据、范围
覆盖不完整和依据就绪。完整正文只保存在受保护载荷，Temporal history 和普通投影只携带 ref、hash
和有界摘要。

### Evidence 引用

`evidence://` 标识 grounding 中的一条已验证依据。Primary Agent 只能引用本轮 context 中出现的
标识；finalization 用同一受保护 context 校验并派生公开来源。

### 工具调用上限

一次 SDK run 允许的最大真实函数工具调用次数。它与 grounding 的候选数量、Temporal retry 和
SDK `maxTurns` 分开计算。

## 检索

### 候选结果

Qdrant 返回且已带 dense+sparse RRF 分数、尚未经过跨 scope 合并、去重和总预算裁剪的内部 chunk。
候选不会自动成为答案依据。

### 混合检索

在冻结的物理 collection 中执行稠密和稀疏候选召回，并由 Qdrant 以 RRF 融合；最终 grounding 还需要
跨 scope 合并、校验和裁剪。

### 有界检索依据

返回给 Primary Agent 的已验证结果。它绑定 scope、release、chunk、section、文档、公开 URL、
正文 hash、token 数和 RRF retrieval score。该分数只用于候选排序和预算选择，不是答案置信度或充分性
证明；当前 JSON 字段仍使用 `rerank_score`，但不代表调用了外部 reranker，代码字段使用 `evidence`。

### 当前发布搜索

在线 grounding 只使用 PostgreSQL `current_releases` 指向的 release。历史 release 可以被离线保留，
但当前不参与 Agent 在线检索。

## 发布与索引

### Knowledge Release

`knowledge_serving` 中一组不可变章节身份和对应 Qdrant 物理 collection 的发布记录。release 记录
包含物理 collection 与 embedding 身份。

### 当前发布指针

PostgreSQL `current_releases` 是每个 scope 的唯一激活指针。execution-control 在 run 准入时解析并
冻结它，运行中不跟随后续变化。

### 检索分块

`retrieval_chunk.v2` 是同一 section 内按本地 tokenizer 预算确定性生成的在线检索单元。它包含正文、
正文 hash、token 数和引用 metadata；分块不能跨 section。

### 物理集合

一次知识发布写入的不可变 Qdrant collection。模型不接收其名称；execution-control 在准入时冻结
该名称。

### 查询配置

服务端维护的语料域、集合、向量名称、embedding instruction、候选限制、版本轨道和可见性规则。
它不向模型或客户端暴露。

### 索引发布

把在线检索 chunk 写入不可变 Qdrant collection、记录 PostgreSQL release 并推进
`current_releases` 的离线过程。当前只有消费合同，没有正式索引生产者和发布数据。文档阅读器
发布完成不等于知识 release 已激活。

## 常见混淆

- 工具开放不等于文档 grounding 可用；
- 文档范围不等于集合、release 或物理 collection；
- grounding 不属于工具轨迹；
- 文档阅读器发布不等于检索索引发布；
- 配置、schema 或评测用例存在不代表环境已经部署该能力；
- Langfuse 中存在 trace 不代表 Temporal workflow 已经成功结束。
