---
doc_type: index
owner_boundary: docs/architecture/domains
status: active
---
# 领域架构

本目录只保存领域专属的长期所有权和运行边界：

- [dining.md](./dining.md)：食堂目录、地图、发布和评价；
- [regulations.md](./regulations.md)：规章来源、规范集合和在线查询边界；
- [curriculum.md](./curriculum.md)：培养方案、派生事实和在线查询边界；
- [notices.md](./notices.md)：通知来源、派生关系和未开放边界；

可由一份文档讲清楚的窄能力进入 `docs/domains/`；本目录不为它们再建立转发文档。数据
结构和接口分别由 `docs/data/` 与 `docs/contracts/` 维护。
