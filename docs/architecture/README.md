---
doc_type: index
owner_boundary: docs/architecture
status: active
---
# 架构文档

`docs/architecture/` 保存产品边界、长期约束和按所有者维护的系统与领域架构。仓库不维护复制
全系统事实的中央当前快照；当前行为由最近的所有者文档、可执行合同和实现共同描述。

- [product.md](./product.md)：产品、用户和明确非承诺；
- [target.md](./target.md)：长期不得回退的架构约束；
- [system/README.md](./system/README.md)：跨领域运行时架构；
- [domains/README.md](./domains/README.md)：领域专属架构。

合同、数据和操作分别进入 `docs/contracts/`、`docs/data/` 和 `docs/runbooks/`，不在本目录
重复维护。未合并的计划和执行记录不进入默认分支的长期文档。
