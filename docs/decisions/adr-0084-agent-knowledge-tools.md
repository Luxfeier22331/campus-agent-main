---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0084
status: accepted
supersedes: ADR-0075
---

# ADR-0084 单一 Agent 与机构知识边界

## 背景

ADR-0075 曾把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff。后续实现保留单一
Primary Agent，但又把 Campus Docs 检索固化为每个有效请求都必须执行的 Temporal Activity，并把
检索结果固定注入模型输入。

这条链路不是通用 RAG 或工具合同。它让问候、改写和个人事实请求也依赖 Qdrant 与 Embedding
Provider，并使 Agent 输入、Temporal history、运行投影、评测和部署配置同时耦合到 Campus Docs。
当前产品尚未确定未来 RAG 的工具形态、检索次数或与其他知识来源的组合方式，不能让临时实现继续
充当长期合同。

## 决策

- 每个在线回答继续只有一个 Primary Agent 和一个最终答案所有者；不恢复 Knowledge Agent、handoff
  或第二次答案合成；
- 当前在线 workflow 不自动执行 Campus Docs 检索，也不向 Agent Runtime 注入固定
  `campus_docs_evidence`；
- 当前不向模型开放机构知识检索工具，Finalization 拒绝未接入能力产生的来源引用；
- Campus Docs 的来源、Chunk、Embedding、Qdrant collection 和发布器继续作为独立离线数据面维护；
  离线索引或当前绑定存在不表示在线 Agent 已经消费它；
- 离线发布继续由 Chunk、Embedding 和 Publisher 三个显式阶段完成，阶段之间只传递内容寻址制品；
- 个人记忆只支持用户自身事实或偏好，不能替代机构知识来源；
- 未来接入 RAG 时，必须同时定义可执行能力合同、模型输入、来源校验、评测和观测字段。本决策不预先
  规定零次、单次或多次检索，也不预先规定 RAG 是否表现为单个工具。

## 结果

- execution-control 不再依赖在线 Qdrant、Embedding 设置、当前索引绑定或检索 Activity；
- Agent Runtime 输入和 Temporal workflow 只保留当前实际开放的能力；
- 在线 Agent 评测不再把机构文档证据当作固定输入，离线 RAG 评测继续验证索引制品；
- 在新的机构知识能力接入前，在线回答不能核实学校事实，必须明确表达能力缺口而不是使用模型记忆
  补全；
- 删除旧类型、阶段耗时、部署变量和兼容路径，不保留隐藏 fallback。

## 未采用方案

- **保留强制检索但允许空结果**：仍让全部请求依赖尚未完成的知识架构；
- **只停止 Activity、保留 evidence 字段和 Qdrant 配置**：会形成没有消费者的兼容面；
- **立即设计新的 RAG 工具**：当前工作只清理错误实现，不能提前冻结后续工具架构。

## 相关文档

- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/retrieval-serving.md`
- `adr-0007-retrieval-strategy.md`
