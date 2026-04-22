---
doc_type: data
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Canonical Document Reader Model

## 文档边界

本文冻结 canonical document reader 的逻辑数据模型。

它回答的是：

- reader projection、published reader assets 与 canonical document truth 的关系是什么
- docs site、docs search、chat source cards 应共享哪些核心字段
- 哪些字段可以进入用户态路由/高亮，哪些只能停留在 retrieval/operator trace

它不负责：

- 具体数据库表或 migration 方案
- Qdrant payload 细节
- source-truth/page-level schema
- donor shell 的 UI 结构

## Goal

在不改写 repo canonical chain 的前提下，为文档阅读、版本切换、docs search、静态 reader asset 发布与 chat citation jump 提供统一的 reader-facing model。

固定目标：

- canonical doc 是唯一用户阅读真相
- public published reader content 优先以静态资产交付
- reader 与 chat citation jump 共享同一定位单位
- version / visibility 从第一天起进入 model，而不是后补

## Position In Canonical Chain

reader model 的长期位置固定为：

`source truth -> declared projections -> canonical document artifacts -> reader projection -> published reader assets`

`source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`

因此：

- reader projection 的语义 owner 是 canonical document layer
- published reader assets 是 reader projection 的发布产物，不是新的 truth layer
- chunk/index 只是检索派生物，不是 reader truth owner
- reader projection 可以复用 `document-units` 的稳定字段，但不等于原始 `document-units.jsonl` 文件逐行直出

## Core Conclusion

用户态稳定定位单位固定拆成两层：

- `anchor`
  - 稳定导航位置
- `rootUnitId`
  - 稳定高亮单位

固定规则：

- `anchor` 负责路由定位、目录跳转、面包屑和版本内深链接
- `rootUnitId` 负责段落命中高亮和 citation jump
- `chunkId`、`sourceUnitKey`、object-storage key 不进入用户态 model

## Logical Objects

### Document Identity

- `docId`
- `documentSlug`
- `corpus`
- `collection`
- `title`
- `visibility`

语义：

- `docId` 表示逻辑文档身份
- `documentSlug` 表示 reader URL 中的稳定路径片段
- `visibility` 表示当前 principal 可否读取，并由 `app-api` 决定

### Document Version

- `versionId`
- `versionSlug`
- `versionLabel`
- `isCurrent`
- `effectiveFrom`
- `effectiveTo`
- `revisionTrack`

语义：

- `versionId` / `versionSlug` 从第一天起进入 contract
- `revisionTrack` 与 canonical document truth 对齐，不由 docs shell 自行发明

### Outline Node

- `anchor`
- `title`
- `depth`
- `parentAnchor`
- `order`

语义：

- `OutlineNode` 是 reader TOC / section navigation 的最小单元
- 它不承载正文内容

### Reader Section

- `anchor`
- `title`
- `order`
- `blocks[]`

语义：

- `ReaderSection` 是一个可导航、可独立回链的阅读段
- section 是 reader 组织单位，不等于 retrieval chunk

### Reader Block

- `rootUnitId`
- `kind`
- `text`
- `inlineLabels`
- `highlighted`

语义：

- `ReaderBlock` 是用户看到的正文块
- `rootUnitId` 是 citation jump / docs search jump 的稳定高亮单位
- `kind` 只表达阅读表现，如 `heading`、`paragraph`、`list`、`table`

### Reader Target

- `docId`
- `versionId`
- `canonicalUrl`
- `anchor`
- `highlightRootUnitIds[]`

语义：

- `ReaderTarget` 是所有跳转类功能的统一目标对象
- docs search result 与 chat source card 都应回收成这个形态

### Reader Asset Descriptor

- `deliveryMode`
- `contentUrl`
- `outlineUrl`
- `integrity`

语义：

- `ReaderAssetDescriptor` 表示某个 resolved reader target 的交付方式
- `deliveryMode` 至少允许：
  - `public_static_asset`
  - `gated_asset`
- 它描述“怎么拿到 published reader payload”，不重写 reader truth
- 它不暴露对象存储 key；对象存储定位只存在于 deploy sync manifest

### Source Card

- `documentTitle`
- `sectionTitle`
- `snippet`
- `versionLabel`
- `readerTarget`

语义：

- `SourceCard` 是 browser-safe citation object
- 它不包含 raw retrieval 分数、raw chunk identity 或 provider/source-truth blob

## Derivation Rules

reader model 与现有 canonical truth 的衔接固定如下：

- `anchor`
  - 来自 canonical `document-units` 中已稳定存在的 `anchor`
- `rootUnitId`
  - 来自 canonical `document-units` 中已稳定存在的 `root_unit_id`
- `text`
  - 来自 canonical 文本表示，而不是 chunk display text 回写
- `versionId`
  - 来自 document registry / version truth，不由 docs shell 自行猜测
- `contentUrl` / `outlineUrl`
  - 来自 published reader asset manifest，而不是由前端字符串猜路径

固定约束：

- 不能因为后续 chunking 改版而改变用户态跳转目标
- 不能因为 docs UI donor 切换而改变 `docId / versionId / anchor / rootUnitId`
- 不能因为静态发布策略变化而改变 canonical reader target 语义

## Visibility And Authorization Fields

reader model 必须显式承载：

- `visibility`
- `isCurrent`
- `versionLabel`

但不承载：

- raw JWT / raw session
- retrieval ACL carrier 原始字段
- captcha / challenge / risk posture

固定规则：

- reader admission 仍由 `app-api` 的 authz truth 决定
- reader model 只消费结果，不解释授权

## Relation To Search And Chat

docs search 与 chat 共享的最小公共子集固定为：

- `documentTitle`
- `sectionTitle`
- `snippet`
- `canonicalUrl`
- `anchor`
- `highlightRootUnitIds`
- `versionLabel`

这意味着：

- docs search 可以直接生成 source-card-compatible result
- chat 可以把 supporting evidence 映射成 reader target，而不回退成 raw trace dump
- 两者都不需要内嵌整篇 reader payload

## Non-Goals

- 不把 reader model 扩成 source-truth replay model
- 不把 reader model 扩成 operator observability source-trace model
- 不把 reader model 扩成 chunk/index schema
- 不把 reader model 降成 donor static-file frontmatter 结构

## 相关稳定文档

- `docs/architecture/document-site-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
