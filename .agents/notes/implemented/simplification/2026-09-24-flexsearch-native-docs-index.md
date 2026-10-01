# Agent Note: 清理文档检索自维护排序器

Status: implemented

完全接受原生排序的选择已由
[Campus Web hash 清理与运行态故障修复](../bug-fix/2026-10-01-campus-ui-hash-and-runtime-cleanup.md)
部分取代，新增标题与精确章节优先；本篇的 Document/Resolver、索引格式与导入导出设计仍有效。

## 背景

文档搜索原先使用 FlexSearch `Index` 做召回，再由 Campus Web 自己维护标题精确度、章节精确度、词覆盖、字段权重、章节短语聚焦度和 FlexSearch 结果位置排序。该比较器重复实现了检索相关性，并且把同一 FlexSearch scoring slot 内的数组位置当成分数，导致输入顺序影响结果。

## 决策

- 使用 FlexSearch `Document` 管理 `documentTitle`、`sectionTitle`、`topicLabel` 和 `searchText` 字段；字段 resolution 和 Resolver `boost` 由单一模块维护。
- 查询词使用 FlexSearch Resolver 的 `and` 组合优先获取完整匹配，再用 `or` 补充部分匹配。
- 构建阶段使用 FlexSearch `Document.export()` 生成序列化 chunks，Worker 使用 `Document.import()` 加载；结果元数据仍由规范化 entries 提供。
- 使用 `store: false`，避免在序列化索引中重复保存正文对象；数字 ID 与 canonical `docId:anchor` 顺序由构建阶段确定。
- 搜索索引合同从 v2 升级到 v3，不提供旧格式运行时兼容。

## 未采用方案

- **继续维护应用层评分器**：会重复 FlexSearch 的字段和 resolution 能力，并保留输入顺序相关的排序债务。
- **保留章节聚焦度或标题精确度重排**：本次明确接受 FlexSearch 原生排序行为，不再扩展产品自定义相关性规则。
- **使用 `store: true`**：会在索引中复制已有 entries 元数据和正文，增加构建产物体积。
- **保留 v2 兼容读取**：静态产物由同一构建链生成，兼容层没有真实消费者。

## 后果

FlexSearch 现在负责字段召回、字段优先级、resolution 和多词 Resolver 组合；Campus Web 只负责规范化输入、ID 映射、链接构造和文档分组。搜索 Worker 不再启动时遍历 entries 建索引，而是导入构建好的索引 chunks。

索引产物变为 v3，构建和解析测试覆盖 chunks、v2 拒绝、export/import round-trip、字段匹配、完整与部分多词匹配以及输入顺序稳定性。FlexSearch 原生排序可能改变历史查询的首项，后续若要重新引入产品排序规则，需要新的真实失败和独立决策。
