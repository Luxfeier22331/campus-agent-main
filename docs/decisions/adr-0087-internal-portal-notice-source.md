---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0087
status: accepted
partially_supersedes: ADR-0024
---
# ADR-0087 内部门户通知来源合同

## 背景

早期通知采集只请求类型 `5`，并在对象路径和每条来源对象中重复保存站点、类型名称和组织名称。
通知消费不按采集批次顺序执行，集群 source bucket 也没有需要迁移的历史通知对象。

## 决策

- 通知选择器确定采集范围，全局列表只提供跨类型增量顺序，不能用通知 ID 数值推断时间；
- 通知 ID 是对象身份，类型和组织 ID 属于对象字段，名称映射集中维护，不在路径和每条对象重复；
- 外链使用明确标记和来源 URL 表达，采集器不请求外部正文或建立外链抓取状态；
- 同步状态只保存增量与历史覆盖边界，已有合法对象不重复请求，不维护内容版本或 `captures/` 批次；
- 分类只确定唯一内部领域，不表示领域消费、对外发布或用户阅读完成，也不写回来源对象。

## 结果

本地采集仍只产生来源对象、统一名称映射和采集边界。后续规范化存储与显式发布由 ADR-0088
定义；ingestion-control 不保存通知内容。

## 相关文档

- `../data/notices.md`
- `../architecture/domains/notices.md`
- `../architecture/system/data-plane.md`
- `../runbooks/ingestion.md`
