---
doc_type: architecture
owner_boundary: apps/campus-web
status: active
---

# 文档站架构

## 边界

Campus Web 在 `/docs` 及正文固定链接提供公开目录、正文、历史版本和浏览器本地搜索。公开阅读与
Campus Docs Chunk builder 共享已清洗的 `source.json` 和 reader 输入，但分别生成静态站点与 RAG 制品；
Campus Web 不创建或激活检索索引，统一 Campus RAG publisher 负责 Docs/Notice serving collection。

```text
reader、课程图来源与图片
-> campus-docs/source.json
├-> Campus Web 构建进程校验 reader 并生成课程图
│  -> 构建派生目录、搜索索引、静态资产和 HTML
│  -> Cloudflare Assets 直接交付静态文件
└-> Campus Docs Chunk/Embedding builder -> Campus RAG unified publisher（独立链路）
```

`app-api`、产品 PostgreSQL、Better Auth 和文档访问准入不在这条链路中。文档来源或构建失败不能
阻塞认证和其他独立服务。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| 来源整理流程 | 生成 reader、课程图来源、图片和 `campus_docs_source.v4` | 生成页面或选择 Worker version |
| 对象存储 | 保存固定来源清单及其明确引用的来源对象 | 保存构建后的课程图或直接承担浏览器接口 |
| Campus Web 来源更新命令 | 规范化、完整校验并更新固定来源键 | 环境流量和线上版本选择 |
| Campus Web 构建 | 再次核对来源并生成课程图、目录、搜索索引、静态资产和 HTML | 修改来源事实或重写 reader |
| TanStack Router | 在已生成路径间切换并保持浏览器历史 | 文档登记和来源发布 |
| FlexSearch Web Worker | 在后台线程加载并查询当前版本搜索索引 | 服务端查询、权限判断和历史版本选择 |
| Cloudflare Assets | 直接提供文档、`/_docs/**`、重定向和 404 页面 | 请求 App API 获取文档或判断访问权限 |

Campus Web 静态交付不维护独立 reader 发布 Job、文档数据库角色或运行时文档 API。独立 Campus Docs
builder 和 Campus RAG serving publisher 由检索服务拥有，不属于静态交付链。

## 构建边界

Campus Web 构建读取对象存储固定键并按[静态交付合同](../../contracts/document-reader-delivery.md)
核对来源、reader 和补充资产，再生成文档站的目录、搜索、静态资源和预渲染页面。精确字段、摘要、
缓存路径和产物布局由合同、数据模型与构建脚本维护。

普通应用使用 `src/main.tsx`，文档页面使用 `src/docs-main.tsx`。两者共享产品导航和基础组件，
但文档代码与样式不进入普通应用入口。

## 公开读取

- 所有文档及历史版本都是公开静态内容，不存在账号可见文档或受限资产路径；
- 正文写入预渲染 HTML，禁用 JavaScript 时仍可阅读；
- JavaScript 只增强站内切换、搜索、版本选择、目录定位、相邻文档导航和复制链接；
- 文档页面不请求 Better Auth、`/api/docs/*` 或其他 App API；
- 浏览器只读取同源 `/_docs/**`，不接触对象存储地址；
- 构建未包含的目录、文档和版本返回真实 `404`，不回退到普通应用外壳。

Cloudflare Assets 以 `drop-trailing-slash` 解析文档 HTML，并按 `_redirects` 和 `404-page` 处理旧链接
与不存在的地址。Worker 不探测、改写、注入或设置 `/docs` 的缓存策略。

## 发布与环境

`pnpm --dir apps/campus-web docs:source:update` 更新固定来源键。`dev` 和 `build` 自动读取该键，
不接受手工文档版本参数。

固定来源键表达完整期望集合。静态构建与 Docs Chunk builder 分别读取它；统一检索 publisher 只消费
显式 Docs/Notice 制品，不直接读取来源清单。两条发布链不维护跨系统事务；具体更新和手动索引步骤见
[Campus Docs 维护与索引发布](../../runbooks/campus-docs.md)。

不可变 Worker version 携带同一构建生成的文档内容；环境仓只选择 Worker version。环境交接和候选
发布不由本文记录，按[运行时发布](runtime-release.md)处理。

## 相关文档

- [文档来源与静态交付合同](../../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../../data/document-reader.md)
- [原生阅读器决策](../../../.agents/notes/implemented/feature/2026-08-01-native-reader.md)
- [运行时发布](runtime-release.md)
