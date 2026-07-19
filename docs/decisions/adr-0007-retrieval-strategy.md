---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0007
status: accepted
---
# ADR-0007 检索策略

## 背景

校级规章和培养方案包含精确术语、条款编号和固定名称。仅使用 dense retrieval 会损失这些
信号，自研 sparse scorer 或 reranker 又会增加第二套搜索引擎和策略面。

## 决策

知识检索使用 Qdrant 原生 dense/sparse prefetch，再使用 Qdrant 原生 reciprocal-rank
fusion。execution-control 拥有 adapter，并只返回有界仓库 DTO；vector-store payload
不得越过运行时合同。

embedding profile、dimension、vector name、analyzer、prefetch limit 和 result limit
属于服务端 serving config，不由本 ADR 固定，也不是模型可见参数。

reranking、HyDE、multi-query expansion 和自动 query rewriting 不作为默认阶段。只有评测
或 production failure 证明现有 hybrid path 存在具体缺口时，才增加其中一项。

target admission、history mode 和 Knowledge Agent 工具参数由 ADR-0075 维护。各 collection
的 chunking 和 embedding compatibility 属于对应配置与 policy。

## 后果

- serving target 必须具备兼容的 dense 和 sparse vector 才能开放。
- 供应商默认值不得静默决定 embedding dimension。
- 检索调优进入受评审的 serving config 和测试，不进入 prompt 或 caller input。
- 不提供本地稀疏检索回退或隐藏的第二检索路径。

## 相关文档

- `docs/architecture/system/retrieval-serving.md`
- `docs/decisions/adr-0075-knowledge-search.md`
- `docs/policies/student-rules-chunking.md`
