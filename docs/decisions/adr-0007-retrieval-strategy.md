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

embedding 身份、dimension、vector name 和 sparse 算法由 publisher 代码内唯一索引定义维护，并随
当前 collection 绑定交给 execution-control。候选上限和结果预算由 execution-control 代码维护。
这些值不是模型可见参数。

reranking、HyDE、multi-query expansion 和自动 query rewriting 不作为默认阶段。只有评测
或 production failure 证明现有 hybrid path 存在具体缺口时，才增加其中一项。

当前正文所有权、不可变索引和运行准入由 ADR-0084 维护。当前文档只使用一个 Campus Docs
collection；分块定义和查询绑定随 collection 一起确定。

## 后果

- 当前 Campus Docs 索引必须具备代码定义的 dense 和 sparse vector 才能准入。
- 供应商默认值不得静默决定 embedding dimension。
- 检索调优直接修改唯一索引定义、重建 collection 并更新测试，不进入 prompt 或 caller input。
- 不提供本地稀疏检索回退或隐藏的第二检索路径。

## 相关文档

- `docs/architecture/system/retrieval-serving.md`
- `docs/decisions/adr-0084-agent-knowledge-tools.md`
- `docs/policies/student-rules-chunking.md`
