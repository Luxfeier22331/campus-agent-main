---
doc_type: requirements
status: deferred
created: 2026-04-22
updated: 2026-04-22
---

# Requirements: Curriculum Course Map Docs Presentation Refinement

## Goal

把 `curriculum_plan` 中课程地图在文档站里的实际显示，从“已可消费的功能性实现”继续收口为“阅读路径清晰、视觉层级成熟、适合真实用户理解培养路线”的产品级展示。

## In Scope

- 文档站内课程地图模块的阅读顺序与默认视图
- route-map-first 的信息架构、分组方式与阶段呈现
- secondary graph view 的存在形式、入口与阅读定位
- 课程详情区、前置/后续关系、原始裁切图、校对说明的版式关系
- 与文档正文、侧边栏、目录和页面整体节奏的整合方式
- 真实课程地图样本页的 smoke / acceptance 口径

## Non-goals

- 课程地图多模态识别、结构化抽取或上游 canonical 产物修正
- 课程地图进入 RAG、chunking 或 retrieval serving
- 重新设计整个 docs shell 或替代 `document-site-and-canonical-reader` workstream
- 新增“先兼容再重写”的临时双轨展示层

## Success Criteria

1. repo 中存在独立 workstream，显式记录“课程地图在文档站中的实际显示仍需继续调整”。
2. 课程地图展示问题被定义为 docs consumption / presentation 问题，而不是再次混回 multimodal probe 或 RAG 范围。
3. 后续恢复时，团队不需要重新争论这条线是挂在 docs workstream 下修，还是单独作为课程地图展示线推进。
4. workstream 已写清后续要解决的是阅读体验、视觉层级、交互入口和验收口径，而不是当前是否“能显示”。

## Canonical Entry

- `.planning/workstreams/curriculum-course-map-docs-presentation-refinement/README.md`
