---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0085
status: accepted
supersedes: ADR-0051
---

# ADR-0085 原生公开文档阅读器

## 背景

文档阅读需要目录、稳定锚点、历史版本、本地搜索、真实 404 和无 JavaScript 的正文。Rspress 在
Campus Web 中引入了独立主题、第二套路由和搜索模型、额外静态命名空间及较重构建，仍需定制产品
导航和发布适配。

早期原生阅读器设计又把部分文档接入 App API 准入和 PostgreSQL 投影。当前产品不需要账号可见
文档，保留这条动态链会让公开阅读依赖认证、数据库和两个版本选择点，并增加无法证明价值的兼容面。

## 决策

- Campus Web 使用已有 React、TanStack Router 和共享组件实现 `/docs/*`；
- 所有已发布文档及历史版本都是公开内容；
- `/docs`、每份文档、历史版本和文档 404 在构建时生成独立 HTML；
- 正文进入预渲染 HTML，禁用 JavaScript 时仍可阅读；
- 全部阅读资产位于 `/_docs/**`，当前版本搜索索引由 FlexSearch 在浏览器 Web Worker 中查询；
- 文档页面不请求 Better Auth、App API 或产品 PostgreSQL；
- Worker 只交付静态文件并为缺失路径返回真实 `404`；
- 普通应用与文档阅读器使用不同前端入口，共享产品组件但不共享文档代码分块；
- Campus Web 在构建时读取固定来源清单，核对其引用并生成完整静态内容；`sourceDigest` 只记录在
  构建和候选元数据中，不进入 Worker 运行配置。

本决策只覆盖公开文档阅读器，不改变独立维护的知识检索系统。

## 结果

- 目录、正文和历史版本不再受 App API、认证或数据库可用性影响；
- 每个 Worker version 自带一致的目录、搜索索引、正文和关联资产；
- 删除 Rspress、`/_gated-docs/**`、`/api/docs/*` 和 `docs.*` 读取投影；
- 删除旧发布清单、当前版本指针和数据库投影合同，不提供运行时兼容；
- 仓库继续维护有限的目录、版本选择、固定链接和搜索交互。

## 未采用方案

- **保留 Rspress 并继续适配主题**：仍会保留双重路由、搜索和构建边界；
- **请求时从 App API 返回正文或资产地址**：公开阅读会获得不必要的认证、数据库和网络依赖；
- **按账号区分文档可见性**：当前没有产品需求，不能为假设场景保留受限资产链；
- **用检索分块拼接正文**：分块生命周期和阅读结构不同，无法提供稳定原文；
- **让文档组件进入普通应用入口**：会增加问答、地图和食堂页面的下载体积。

## 相关文档

- `../architecture/system/document-site.md`
- `../contracts/document-reader-delivery.md`
- `../data/document-reader.md`
