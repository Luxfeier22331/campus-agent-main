---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0051
status: accepted
---
# ADR-0051 Rspress 文档阅读器

## 背景

校园规章和培养方案需要目录、稳定锚点、版本、段落链接、本地搜索和受限访问。文档阅读还要与
问答来源卡片共享固定链接，但不能把检索分块或对象存储文件直接交给浏览器。

## 决策

- Campus Web 在同一产品入口的 `/docs/*` 提供文档阅读器；
- Rspress 负责静态页面、目录、锚点和浏览器本地搜索；
- 规范文档经过 `jobs/docs-publish` 生成内容寻址 release、静态阅读资产和 app-api 读取投影；
- 公开正文随 Campus Web 静态资产交付，不在每次阅读时从 app-api 返回全文；
- 受限正文和搜索索引由 Campus Web Worker 向 app-api 完成访问准入后交付；
- 来源卡片、文档搜索和直接阅读使用同一固定链接、版本、锚点和高亮标识；
- Worker 构建与 app-api 读取投影必须固定到同一文档 release。

## 结果

- 文档阅读获得成熟的静态站点导航和搜索能力；
- 浏览器不接触数据库、对象存储内部位置和检索索引；
- 公开阅读不依赖逐页动态正文接口，受限内容仍由服务端判定权限；
- 阅读器正文、聊天检索和来源卡片共享规范文档身份，但保持不同交付产物。

## 未采用方案

- 建立独立于 Campus Web 的第二个学生产品入口；
- 在普通 React 页面中重新实现完整文档站能力；
- 让 app-api 在每次阅读时返回整篇正文；
- 用检索分块、原始采集产物或对象存储地址作为阅读页面；
- 让浏览器选择文档 release 或自行解释访问权限。

## 相关文档

- `../architecture/system/document-site.md`
- `../contracts/app-api/document-reader.md`
- `../contracts/document-reader-publish.md`
- `../data/document-reader.md`
