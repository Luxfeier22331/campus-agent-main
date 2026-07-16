---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 在线查询与索引术语

本文解释代码和配置中使用的查询、检索与索引术语。实现状态仍以注册表、合同和代码为准。

## 产品与数据

### 阅读器固定链接

面向用户的稳定文档 URL，例如 `/docs/:corpus/:collection/:docSlug`。链接中不包含分块标识
或对象存储位置。

### 来源通道

`source channel` 表示一类来源的采集适配器和来源记录边界。一个来源通道可以向多个语料域
或集合提供资料。

### 语料域

`corpus` 表示一类广义机构知识，例如 `regulations` 或 `curriculum`。

### 集合

`collection` 是语料域内规范文档和索引的所有权单元，例如
`regulations/student_rules`。集合名不是模型可选择的工具参数。

### 查询目标

`target` 是 Knowledge Agent 可选择的语义目标，例如 `student_rules`。查询目标注册表把
它映射到服务端控制的集合和检索配置。目标、语料域、集合和 Qdrant 别名不是同一个概念。

### 工具读取模型

结构化工具使用的有类型读取模型。它不经过通用知识检索。例如
`transport_schedule_lookup` 读取班车时刻表模型。

## Agent 与工具

### 模型可见工具

当前运行中通过 `tools.v5.json` 向 Primary Agent 暴露的函数工具或移交目标。

### 内部工具

只向所属 Agent 开放的已注册工具。例如 `knowledge_search` 只向 Knowledge Agent 开放。

### 知识移交

Primary Agent 通过 OpenAI Agents SDK 的 `handoff()` 把问题交给 Knowledge Agent。当前载荷
只包含完整的 `query_text`。

### 知识搜索

Knowledge Agent 对一个查询目标执行的一次有界搜索。它在同一个 SDK Agent Activity 中完成，
不会新增 Temporal 阶段。

### 搜索次数上限

一次 SDK 运行允许的最大内部搜索次数。该值由 execution-control 配置维护，与 Temporal
重试次数和 SDK `maxTurns` 分开计算。

## 检索

### 当前版本搜索

`include_history=false`。只保留标记为当前版本的文档。

### 含历史版本搜索

`include_history=true`。允许返回已准入的历史版本，但不能用它任意解析内部版本标识。

### 候选结果

Qdrant 返回且尚未经过来源校验和数量限制的内部结果。候选结果不会自动成为答案依据。

### 混合检索

先执行 Qdrant 稠密和稀疏向量预取，再使用倒数排名融合（RRF）合并排序。

### 有界检索依据

返回给 Knowledge Agent 的已验证结果。它包含稳定的依据、文档和分块标识，查询目标，安全
摘要，来源 URL，可选版本以及排名信息。代码字段仍使用 `evidence`。

### 已使用目标

`resolved_targets[]` 表示最终运行中确实完成搜索并支持答案的去重查询目标。它是终结和评测
记录，不是调用方输入。

## 索引

### 分块准备

写入向量索引前，对文档单元执行离线清理、分块和校验。

### 物理集合

一次索引发布写入的带版本 Qdrant collection。运行时不应直接依赖它的名称。

### 服务别名

检索配置引用的稳定 Qdrant alias，由离线发布操作切换。

### 查询配置

服务端维护的语料域、集合、别名、向量名称、返回上限、版本轨道和可见性规则。

### 索引发布

写入经过验证的物理集合并切换服务别名。文档阅读器发布完成，不代表索引已经发布或查询
目标已经开放。

## 常见混淆

- 工具开放不等于查询目标开放；
- 查询目标不等于集合或 Qdrant 别名；
- 文档阅读器发布不等于检索索引发布；
- 查询配置不向模型暴露；
- 评测用例不是来源资料，也不能自动开放运行能力；
- Langfuse 中存在轨迹不代表 Temporal 工作流已经成功结束。
