---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 主题索引

本文按主题聚合分散在各分区的相关文档，解决"想看某个主题的全部文档却不知从哪入手"的问题。
每个主题只放链接，不复制正文；事实仍由所属文档维护。新主题或链接随相关文档一并更新。

## 校园地图

- [校园地点（地点目录与地图读取）](../domains/place.md)
- [校园地图制图流程](../runbooks/campus-map-authoring.md)
- [校园地图资产（清单、命令与署名）](../../apps/campus-web/assets/campus-map/README.md)
- [导航边界](../../.agents/notes/implemented/architecture/2026-07-16-navigation.md)
- [校园地图渲染](../../.agents/notes/implemented/architecture/2026-07-16-map-provider.md)

## 通知

- [通知领域（架构边界）](../architecture/domains/notices.md)
- [通知数据](../data/notices.md)
- [App API 通知接口](../contracts/app-api/notices.md)
- [Ops Web 通知合同](../contracts/ops-web/notices.md)
- [采集运行](../runbooks/ingestion/ingestion.md)
- [通知索引（Chunk 与 Embedding）](../runbooks/ingestion/notice-indexing.md)

## 食堂

- [食堂（产品需求）](../product/dining.md)
- [Dining 领域包](../../packages/domains/dining/README.md)
- [食堂地图阅读与导航](../../.agents/notes/implemented/bug-fix/2026-09-18-dining-map-navigation.md)

## 交通

- [交通班次领域](../domains/transport.md)
- [共享类型与展示标签](../../packages/domains/transport/README.md)

## 可观测性

- [运行时遥测（字段与边界）](./telemetry.md)
- [Worker 发布与平台诊断](../runbooks/observability/worker-otel.md)
- [Langfuse 运行合同](../contracts/langfuse-runtime.md)

## 文档站与阅读器

- [文档站架构](../architecture/system/document-site.md)
- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../data/document-reader.md)
- [Docs 来源声明](../../apps/campus-web/docs-source/README.md)
- [Campus Docs 维护与索引发布](../runbooks/ingestion/campus-docs.md)
