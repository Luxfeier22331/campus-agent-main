---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0075
status: superseded
superseded_by: ADR-0084
---
# ADR-0075 基于目标的知识搜索

本决策已由 ADR-0084 取代。本文只保留当时选择 Knowledge Agent、handoff 和目标搜索的历史理由，
不描述当前运行方式。

## 背景

Knowledge Agent 需要能够重写问题并搜索多个受治理知识面。让产品传输层选择检索范围、版本或
存储位置，会使调用方参与检索规划并重复服务端策略。

## 决策

OpenAI Agents SDK 是唯一语义代理与工具循环。Primary Agent 可以进入 Knowledge Agent；Knowledge
Agent 根据 execution-control 提供的已开放语义目标执行有界搜索。产品调用方和模型不能选择
collection、索引、向量库、供应商或检索参数。

execution-control 负责运行身份、访问权限、目标注册表、服务配置、检索和依据投影。Knowledge
Agent 负责选择语义目标、改写查询和判断证据是否足够。终态处理只校验已投影的依据并生成来源，
不调用模型或改写答案。Agent 内部 handoff 和搜索保持在同一个 SDK run 中，不形成另一张
Temporal 工作流图。

## 未采用方案

- **调用方选择范围或版本**：会让产品与评测调用方成为检索规划者。
- **工具参数暴露存储控制**：会绕过目标准入并泄露数据面拓扑。
- **Go 自建检索规划器**：会复制 Knowledge Agent 的语义循环。

## 后果

- 工具和查询目标分别由版本化注册表维护。
- 多目标与后续搜索是普通的有界 SDK 工具调用。
- 搜索结果只暴露有界依据和稳定引用，不暴露检索基础设施。
- 工具评测可以观察公开 handoff 与内部搜索序列。

当前工具参数、目标配置、检索过程和评测字段分别见：

- `docs/contracts/tool-execution.md`
- `docs/architecture/system/retrieval-serving.md`
- `docs/architecture/system/agentic-retrieval.md`
- `docs/contracts/tool-trajectory.md`
