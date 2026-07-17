---
doc_type: architecture
owner_boundary: apps/campus-web
status: active
---
# 文档站架构

## 文档边界

本文定义 `campus-web /docs/*`、Rspress、`app-api` 和文档发布产物之间的所有权。接口字段、
读取模型和发布包格式分别由合同与数据文档维护；当前已部署内容由环境状态判断。

## 主链

```text
来源资料
-> 规范文档
-> 阅读器读取模型
-> 已发布阅读器资产
-> campus-web /docs/*
```

文档站与问答检索共享规范文档和版本信息，但使用不同的发布产物：

```text
规范文档 -> 阅读器资产 -> 文档站
规范文档 -> 分块与索引 -> 知识搜索
```

阅读器资产不能反向成为规范文档，检索分块也不能作为用户阅读正文。

## 所有权

| 所有者 | 负责 | 不负责 |
| --- | --- | --- |
| `campus-web` | `/docs/*` 路由、Rspress 构建、静态资产交付和阅读交互 | 文档注册、版本和访问权限 |
| Rspress | 页面渲染、目录、稳定锚点和本地搜索界面 | 规范文档和权限判断 |
| `app-api` | 按 Worker 指定 release 读取导航、版本、资产解析和受限访问准入 | 发布、选择 release 或返回整篇正文 |
| `jobs/docs-publish` | 发布内容寻址 release 并物化 release-scoped 读取投影 | 浏览器会话、在线搜索或环境流量选择 |
| 对象存储 | 保存带摘要的发布产物 | 直接向浏览器公开内部对象路径 |

## 正文交付

- 已发布的公开文档随 `campus-web` 静态资产交付；读取正文不需要每次请求 `app-api`。
- 受限文档必须先经过同源 Worker 和 `app-api` 的访问准入，再交付对应资产。
- 浏览器不得直连对象存储、数据库或检索索引。
- `app-api` 返回导航、版本和资产定位信息，不承担通用文件代理。
- 仓库中的构建目录只是发布输入或复制品，不能成为线上正文的唯一来源。

Cloudflare 静态资产路由只负责交付方式，不拥有文档、版本或访问权限。

## 构建与发布

- 本地和浏览器回归使用仓库内无凭据 fixture 构建 Rspress 阅读面。
- 发布任务消费已验收读取投影，生成内容寻址 manifest，并以专用数据库角色物化同一 release。
- Campus Web release build 只接受 `docsReleaseId`，由它推导 manifest key 和摘要；构建不连接
  app-api 数据库。
- Worker 固定注入 `docsReleaseId`，GitOps 同时选择 Worker version 与该 docs release。
- staging 与正式发布复用同一个 `build:release` 入口；不得恢复构建期数据库导出或单独的
  `build-published-reader-docs.ts --staging` 路径。

## 搜索

- 公开当前文档使用构建时生成的 Rspress 本地搜索索引。
- 公开索引不得包含受限文档、引导页或历史版本。
- 受限文档的搜索索引必须先通过 `app-api` 准入，再由浏览器本地查询；查询词不发送到
  文档接口。
- 文档站搜索帮助用户定位文档或段落；聊天检索负责依据内容回答问题。两者不得共用一条
  浏览器查询接口。

## 链接与版本

来源卡片、文档搜索结果和直接阅读必须落到同一个阅读器固定链接。无版本链接表示当前可见
版本；查看历史版本必须显式携带版本。段落锚点和临时高亮的具体格式由
[source-card.md](../../domains/source-card.md) 与接口合同维护。

阅读器和聊天检索必须使用同一份文档可见性和版本事实。文档在阅读器中不可见时，聊天也
不得因为索引中仍有数据而返回其内容。

## 不允许的形态

- 恢复独立的 `public-docs` 产品入口；
- 在 React 页面中重新实现一套完整文档阅读器；
- 让文档站直连数据库、对象存储或 Qdrant；
- 把原始采集产物、检索分块或供应商响应当作阅读正文；
- 让静态化绕过服务端访问准入；
- 把文档搜索与聊天回答合并成同一个接口。
- 让浏览器、GitHub Environment variable 或“最新 manifest”选择 docs release。

## 相关文档

- [当前架构](../current.md)
- [文档阅读器接口](../../contracts/app-api/document-reader.md)
- [发布合同](../../contracts/document-reader-publish.md)
- [读取模型](../../data/document-reader.md)
- [来源卡片](../../domains/source-card.md)
- [ADR-0051](../../decisions/adr-0051-document-site.md)
