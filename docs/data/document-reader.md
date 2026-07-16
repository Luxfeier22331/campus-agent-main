---
doc_type: data
owner_boundary: data-plane/document-reader
status: active
---
# 文档阅读器数据模型

## 文档边界

本文定义文档阅读器、文档站搜索和聊天来源卡片共享的逻辑数据模型。数据库表、HTTP 字段和
发布包格式由各自合同维护。

## 数据链位置

```text
来源资料 -> 规范文档 -> 阅读器模型 -> 已发布阅读器资产
来源资料 -> 规范文档 -> 文档单元 -> 分块 -> 检索索引
```

阅读器和检索可以使用同一份规范文档，但阅读器正文不能来自检索分块。已发布阅读器资产是
阅读器模型的交付结果，不是另一份文档事实。

## 稳定标识

用户定位由两个标识组成：

- `anchor`：章节内的稳定导航位置，用于 URL 锚点、目录和深链接；
- `rootUnitId`：稳定正文块，用于搜索命中和来源卡片高亮。

`chunkId`、`sourceUnitKey` 和对象存储路径不能进入用户 URL。重新分块、改变搜索引擎或更换
阅读器界面都不得改变 `docId`、`versionId`、`anchor` 和 `rootUnitId` 的含义。

## 逻辑对象

### 文档标识

字段：`docId`、`documentSlug`、`corpus`、`collection`、`title`、`visibility`。

- `docId` 标识一份逻辑文档；
- `documentSlug` 是控制接口中的稳定文档标识，不保证能直接作为浏览器路径；
- `campus-web` 可以在构建时生成 URL 安全的路径，但该路径不能替代 `documentSlug`；
- `visibility` 是 `app-api` 已经判定的读取结果，阅读器不自行解释权限。

### 文档版本

字段：`versionId`、`versionSlug`、`versionLabel`、`isCurrent`、`effectiveFrom`、
`effectiveTo`、`revisionTrack`。

版本标识来自文档注册与版本数据。无版本链接表示当前可见版本；历史版本必须显式指定。

### 目录节点

字段：`anchor`、`title`、`depth`、`parentAnchor`、`order`。

目录节点只负责章节导航，不包含正文。

### 阅读器章节

字段：`anchor`、`title`、`order`、`blocks[]`。

章节是可导航的阅读单位，不等于检索分块。

### 阅读器正文块

字段：`rootUnitId`、`kind`、`text`、`inlineLabels`、`highlighted`。

`kind` 只描述阅读表现，例如 `heading`、`paragraph`、`list` 或 `table`。

### 阅读器固定链接

字段：`docId`、`versionId`、`permalink`、`anchor`、`highlightRootUnitIds[]`。

文档搜索和聊天来源卡片都使用该对象作为跳转目标。既有 HTTP 字段 `canonicalUrl` 表示阅读器
固定链接，不表示 SEO canonical URL。

### 阅读器资产

字段：`deliveryMode`、`contentUrl`、`outlineUrl`、`integrity`。

`deliveryMode` 当前允许 `public_static_asset` 和 `gated_asset`。该对象说明如何读取已发布
内容，不暴露对象存储路径；内部对象位置只进入部署同步清单。

### 来源卡片

字段：`documentTitle`、`sectionTitle`、`snippet`、`versionLabel`、`readerTarget`。

来源卡片只包含浏览器可见摘要和阅读器目标，不包含原始检索分数、分块内部标识、供应商
响应或来源原始内容。

## 派生规则

- `anchor` 来自规范文档单元中的 `anchor`；
- `rootUnitId` 来自规范文档单元中的 `root_unit_id`；
- `text` 来自规范文本，不从检索分块回写；
- `versionId` 来自文档注册与版本数据；
- `contentUrl` 和 `outlineUrl` 来自已发布阅读器资产清单，前端不得猜测路径。

这些字段的写入器和产物路径由 TypeScript ingestion owner 维护。Python 不拥有通用文档导入、
注册、对象路径或跨语言 DTO。

## 可见性

阅读器模型必须包含 `visibility`、`isCurrent` 和 `versionLabel`，但不得包含原始 JWT、会话、
验证码、风险状态或检索权限内部字段。

阅读器与聊天检索必须使用同一份版本和可见性结果。阅读器只消费 `app-api` 的准入结果，不
自行推导用户权限。

## 搜索与问答

文档搜索和聊天来源卡片共享：

- 文档标题、章节标题和安全摘要；
- 阅读器固定链接、锚点和高亮标识；
- 版本标签。

两者都不需要返回整篇阅读器正文，也不能把原始检索轨迹直接发送给浏览器。

## App API 读取模型

`apps/app-api` 使用 `docs.*` 保存浏览器读取所需的关系型投影：

- `docs.collections`：文档集合名称与展示信息；
- `docs.documents`：逻辑文档、固定标识和当前版本；
- `docs.document_versions`：版本、当前标记、可见性和交付方式；
- `docs.reader_assets`：已发布内容、目录和清单的读取位置；
- `docs.search_units`：文档站搜索使用的章节命中信息。

这些表不是规范文档或对象存储产物的替代品。浏览器响应不得暴露对象存储路径、来源内部
位置或检索分块标识。

## 不负责

- 来源资料的采集和保存；
- 数据库迁移和物理表；
- 检索分块、向量索引和 Qdrant 载荷；
- 文档站界面和主题；
- 运维观测中的原始来源记录。

## 相关文档

- [文档站架构](../architecture/system/document-site.md)
- [数据链](../architecture/system/data-plane.md)
- [文档发布合同](../contracts/document-reader-publish.md)
- [来源卡片](../domains/source-card.md)
- [文档历史 ADR](../decisions/adr-0014-document-history.md)
