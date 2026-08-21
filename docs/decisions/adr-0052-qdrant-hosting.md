---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0052
status: accepted
---

# ADR-0052 Qdrant 托管方式

## 背景

当前系统使用私有自托管 Qdrant。Qdrant 的容量、节点资源和具体集合数量属于部署状态，不应被
写成长期架构承诺。

## 决策

Qdrant 自托管且不公开。除非新的可用性需求经过独立评审，否则保持 single-node。

- 在线执行只使用查询所需的受限凭据；索引维护身份由索引发布路径使用；
- Qdrant 不直接暴露到公共网络；存储、TLS、密钥和拓扑由环境仓维护；
- 本地 Compose 只用于开发，不定义环境部署方式；
- Qdrant 只保存可由已开放文档制品重建的索引，不作为文档来源事实。

## 结果

- single-node 不构成 high-availability 声明；
- PostgreSQL `campus_docs_serving.current_index` 只选择当前 collection，查询定义由当前代码拥有；
  collection 名称不承担环境状态或历史版本语义；
- 具体备份、恢复和保留操作由环境 runbook 维护，不在本 ADR 固定实现细节。

## 外部参考

- <https://qdrant.tech/documentation/concepts/snapshots/>
- <https://qdrant.tech/documentation/guides/security/>
