---
doc_type: architecture
owner_boundary: apps/campus-web
status: active
---

# 文档站架构

## 边界

Campus Web 在 `/docs` 及正文固定链接提供公开目录、正文、历史版本和浏览器本地搜索。公开阅读链路
独立于知识检索的输入、索引和运行配置。

```text
reader、课程图来源与图片
-> campus-docs/source.json
-> Campus Web 构建进程校验 reader 并生成课程图
-> 构建派生目录、搜索索引、静态资产和 HTML
-> Cloudflare Assets 直接交付静态文件
```

`app-api`、产品 PostgreSQL、Better Auth 和文档访问准入不在这条链路中。文档来源或构建失败不能
阻塞认证和其他独立服务。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| 来源整理流程 | 生成 reader、课程图来源、图片和 `campus_docs_source.v3` | 生成页面或选择 Worker version |
| 对象存储 | 保存固定来源清单及其明确引用的来源对象 | 保存构建后的课程图或直接承担浏览器接口 |
| Campus Web 来源更新命令 | 规范化、完整校验并更新固定来源键 | 环境流量和线上版本选择 |
| Campus Web 构建 | 再次核对来源并生成课程图、目录、搜索索引、静态资产和 HTML | 修改来源事实或重写 reader |
| TanStack Router | 在已生成路径间切换并保持浏览器历史 | 文档登记和来源发布 |
| FlexSearch Web Worker | 在后台线程加载并查询当前版本搜索索引 | 服务端查询、权限判断和历史版本选择 |
| Cloudflare Assets | 直接提供文档、`/_docs/**`、重定向和 404 页面 | 请求 App API 获取文档或判断访问权限 |

仓库不维护独立文档发布 Job、文档数据库角色或运行时文档 API。

## 构建输入

Campus Web 始终读取对象存储固定键 `campus-docs/source.json`。来源清单必须是规范化的
`campus_docs_source.v3` JSON，并明确引用 reader、课程图来源和图片。构建逐个核对
`key`、`byteSize` 和 `sha256`，校验 reader 身份与元素结构，再生成最终课程图。

来源精确字节的 SHA-256 决定本地缓存目录：

```text
.generated/docs-content/sources/sha256-<source-digest>
```

缓存目录包含来源副本、已核对来源对象、构建目录、公开资产和按需生成的页面。开发服务准备目录、
索引和阅读资产；正式构建还生成全部 HTML。不同来源摘要不会互相覆盖。

## 构建产物

- `build/catalog.json`：仅供构建和预渲染使用的完整路由目录；
- `public/_docs/site-index.json`：公开主题、集合、文档、版本、搜索入口和旧正文路由；
- `public/_docs/search/sha256/<digest>.json`：当前版本的内容寻址搜索索引；
- `public/_docs/**`：全部版本的 reader、课程图和图片；
- `pages/docs/**/index.html`：`/docs`、正文和历史版本；`pages/docs/404.html` 为专用 404 页面；
- `public/_headers`、`public/_redirects`：文档静态响应头和旧正文 308 重定向。

站点索引直接从来源清单和编译结果派生。搜索索引从当前版本 reader 的标题、正文和结构化表格派生，
历史版本不进入搜索。搜索索引 URL 包含内容摘要，因此新构建不会复用旧浏览器缓存。

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

## 目录、搜索与链接

`/docs` 是唯一目录入口，完整文档树位于侧边栏和移动端目录。培养方案集合和规章主题只负责展开或
收起文档列表，不生成独立目录页面。根页侧栏默认收起各分组，正文页自动展开当前位置；根页主内容
仍完整展示发布目录，不依赖侧栏展开状态。

`/docs/<corpus>` 与 `/docs/<corpus>/<collection>` 返回 `404`。每份当前文档使用固定链接，历史版本
使用显式版本路径。来源清单的 `redirects[]` 只允许旧正文地址指向现有正文固定链接，Worker 不维护
硬编码重定向表。

搜索对完整当前版本索引执行查询，按文档聚合章节命中。首次只把 8 篇文档、每篇 3 个章节传回页面；
展开某篇文档或继续显示时，浏览器再向搜索 Worker 请求对应结果。

## 发布与环境

`pnpm --dir apps/campus-web docs:source:update` 更新固定来源键。`dev` 和 `build` 自动读取该键，
不接受手工文档版本参数。

`CAMPUS_WEB_BUILD_TARGET` 和 `CAMPUS_WEB_DOCS_CONTENT_ROOT` 仅用于构建进程之间传递目标和本地目录。
对象存储连接变量只由受信任的来源准备命令消费，不进入 Vite 子进程、Worker 或静态产物。PR 与当前
staging 候选验证使用确定性测试文档，不读取对象存储；真实文档构建仍由受信任入口单独执行。

构建把来源摘要写入候选元数据，但它不是 Worker 运行配置或独立环境选择。一个不可变 Worker
version 自带完整文档内容；环境仓只选择 Worker version，回滚时目录、搜索索引、正文和图片一起回滚。

## 相关文档

- [文档来源与静态交付合同](../../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../../data/document-reader.md)
- [原生阅读器决策](../../decisions/adr-0085-native-reader.md)
- [运行时发布](runtime-release.md)
