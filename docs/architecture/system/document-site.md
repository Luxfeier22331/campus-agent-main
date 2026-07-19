---
doc_type: architecture
owner_boundary: apps/campus-web
status: active
---
# 文档站架构

## 边界

Campus Web 在 `/docs/*` 提供 Rspress 阅读器。文档站与知识检索共享规范文档和版本信息，但分别
消费阅读器资产和检索索引；检索分块不能作为阅读正文。

```text
规范文档 -> 阅读器模型 -> 已发布阅读器资产 -> Campus Web 文档站
规范文档 -> 文档单元 -> 分块与索引 -> Knowledge Agent
```

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/campus-web` | `/docs/*` 路由、Rspress 构建、静态资产交付和阅读交互 | 文档注册、版本与权限判断 |
| Rspress | 页面渲染、目录、锚点和本地搜索界面 | 规范文档和用户授权 |
| `apps/app-api` | 指定 release 的导航、版本、资产解析和受限访问准入 | 发布、选择 release、返回整篇正文 |
| `jobs/docs-publish` | 发布内容寻址 release 并物化 app-api 读取投影 | 浏览器会话、环境流量和在线检索 |
| 对象存储 | 保存带摘要的发布产物 | 向浏览器公开内部对象路径 |

## 正文交付

- 公开文档随 Campus Web 静态资产交付，普通阅读不逐页请求 app-api；
- 受限文档由同源 Worker 向 app-api 完成访问准入后交付；
- app-api 返回导航、版本和资产定位信息，不作为通用文件代理；
- 浏览器不直连对象存储、数据库或 Qdrant；
- Campus Web Worker 固定当前文档 release，浏览器不能选择其他 release。

发布合同保证 Worker 内静态资产与 app-api 读取投影来自同一 release。源码仓的本地 fixture 只
用于开发和浏览器回归，不表示环境已经发布对应内容。

## 搜索与链接

公开当前文档使用构建时生成的 Rspress 本地搜索索引。受限文档索引必须先通过同一文档版本的
访问准入，再由浏览器本地查询；查询词不发送到 app-api。

文档搜索只帮助定位文档或段落，聊天检索负责依据内容回答问题。来源卡片、搜索结果和直接阅读
使用相同固定链接；历史版本必须在链接中显式指定。锚点和高亮规则由
`../../domains/source-card.md` 维护。

阅读器和聊天检索使用同一份版本与可见性结果。阅读器不可见的文档不能因旧索引仍存在而进入
回答证据。

## 相关文档

- [App API 文档接口](../../contracts/app-api/document-reader.md)
- [发布合同](../../contracts/document-reader-publish.md)
- [读取模型](../../data/document-reader.md)
- [来源卡片](../../domains/source-card.md)
- [ADR-0051](../../decisions/adr-0051-document-site.md)
