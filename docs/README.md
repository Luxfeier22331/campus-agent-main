---
doc_type: index
owner_boundary: docs
status: active
---

# 文档

`docs/` 保存 `campus-agent` 可长期引用的文档。当前事实由最近的所有者文档和可执行实现维护；
其他文档只提供必要路由，不复制所属正文或全系统当前快照。
文档放置与写作遵循[文档规范](./AGENTS.md)，分工理由见
[ADR-0038](../.agents/notes/implemented/process/2026-07-16-adr-0038-documentation.md)。

## 首要入口

- 产品边界、用户与非承诺：[architecture/product.md](./architecture/product.md)
- 当前实现入口：[architecture/README.md](./architecture/README.md)
- 长期架构约束：[architecture/target.md](./architecture/target.md)

## 分区入口

- [architecture/README.md](./architecture/README.md)：产品、当前、目标和支撑架构
- [product/README.md](./product/README.md)：功能 PRD 和用户验收要求
- [architecture/system/README.md](./architecture/system/README.md)：跨领域运行时边界
- [architecture/domains/README.md](./architecture/domains/README.md)：领域和工具架构
- [domains/README.md](./domains/README.md)：窄能力的人类文档
- [contracts/README.md](./contracts/README.md)：HTTP、运行时和工具合同
- [data/README.md](./data/README.md)：数据结构和读取模型所有权
- [决策笔记](../.agents/notes/README.md)：决策记录生命周期和理由（`.agents/notes/`）
- [postmortem/README.md](./postmortem/README.md)：真实故障、漏检原因与回归防护
- [reference/README.md](./reference/README.md)：术语、矩阵和稳定参考
- [runbooks/README.md](./runbooks/README.md)：可重复的操作步骤
- [environment/README.md](./environment/README.md)：环境变量、供应商和 Secret 所有权
- [policies/README.md](./policies/README.md)：治理规则和采集策略
