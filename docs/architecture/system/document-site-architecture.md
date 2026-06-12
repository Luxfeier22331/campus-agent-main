---
doc_type: architecture
status: active
created: 2026-04-21
updated: 2026-06-12
---
# Document Site Architecture

## 文档边界

本文冻结 `campus-web /docs/*` 与 canonical document reader 的前向 supporting
architecture。

它回答的是：

- 文档阅读在 `campus.muc.wiki` 统一产品入口内属于谁
- `campus-web`、Rspress、`app-api`、published reader assets 与 canonical document
  model 各自负责什么
- 为什么 canonical doc 正文优先以 published reader assets / Rspress-built reader
  pages 交付，而不是每次经 API 返回整篇正文
- chat 来源、docs search 与直接阅读为什么必须共享同一个 reader permalink

它不负责：

- 某个 collection 的 split / cleanup / OCR / chunking 细节
- Rspress 主题的像素级实现
- RAG query-serving alias 切换策略

## Core Conclusion

长期上，文档阅读面固定为：

`browser -> campus-web /docs/* -> Rspress-powered canonical reader`

`campus-web same-origin /api/docs/* -> app-api docs control plane`

`canonical document artifacts -> reader projection -> published reader assets ->
campus-web Rspress docs source/build output`

这意味着：

- `campus-web` 是学生侧产品入口、账号壳、导航与 `/docs/*` browser route owner
- Rspress 是 docs reader/render engine；Pagefind 是 public static docs search
  engine；二者都不拥有 canonical document truth
- `app-api` 继续拥有 docs publish manifest、restricted/gated navigation/search/resolve/version/
  admission truth
- published reader assets 是正文发布产物，不是新的 truth layer
- Q&A source card、docs search result 与直接阅读必须落到同一 reader permalink
- 旧 `apps/public-docs` 不再是 forward product surface；它只保留为 Rspress/MDX/
  anchor/highlight/search 管线的 reference implementation

## Ownership

### `apps/campus-web`

长期负责：

- `/docs/*` 同源产品入口与支撑页导航
- Rspress-built reader assets 的 browser delivery
- same-origin `/api/docs/*` allowlisted proxy seam
- 与 Q&A source card、account shell、map/dining/feedback 的视觉与路由一致性

长期不负责：

- canonical document registry
- visibility / entitlement truth
- public static search ranking truth 或 restricted / gated docs search ranking truth
- reader asset manifest truth
- raw chunk、source-truth 或 provider artifact 解释

### Rspress Reader Engine

长期负责：

- MDX reader rendering
- docs-native TOC / outline / page shell
- stable anchor DOM 与 `data-root-unit-id` highlight DOM
- version switcher / reader enhancer 这类 reader interaction

固定约束：

- Rspress 只能消费 canonical reader projection 或由它生成的 MDX
- Rspress frontmatter、route file 或 search index 不成为 document/version truth
- 更换 reader engine 必须更新 ADR、contract tests 与 build gate

### Pagefind Public Search Engine

长期负责：

- build-time public current docs static index
- public docs search UI 与 browser-side search execution
- public result 到 reader permalink 的回链映射

固定约束：

- Pagefind 只索引 anonymous public current reader pages
- gated / restricted、bootstrap、collection index 与 historical `/v/*` 页面不得进入匿名索引
- Pagefind sidecar 只能消费 app-api docs sync manifest 中的 public current search units

### `apps/app-api`

长期负责：

- reader admission
- canonical visibility / authz resolution
- current-vs-historical version resolution
- published reader asset resolution
- restricted / gated docs search runtime APIs
- citation/source-card reader permalink shaping

长期不负责：

- docs shell layout
- Rspress theme
- 每次 reader request 返回整篇正文
- raw provider/source-truth 可视化

## Canonical Reader Model

reader 只允许建立在 canonical document truth 之上。

固定链路为：

`source truth -> declared projections -> canonical document artifacts -> reader
projection -> published reader assets`

`source truth -> declared projections -> canonical document artifacts ->
document-units -> chunks -> index`

用户态稳定定位单位固定拆成两层：

- `anchor`
  - 稳定导航位置，进入 URL fragment identifier：`#anchor`
- `rootUnitId`
  - 稳定高亮单位，进入 highlight query parameter：`?hl=rootUnitId`

固定规则：

- `chunkId`、`sourceUnitKey`、object-store key 不进入用户态 route
- reader projection 与 retrieval index 可以共用 canonical document truth，但不能互相冒充
- published reader assets 来自 canonical reader projection，而不是来自 chunk payload
- reader 不直接读取 Qdrant、chunk payload、source-truth/page manifest 或 provider artifact

## Delivery Model

canonical doc 正文交付长期采用：

- Rspress-built reader pages / static reader assets
- restricted / gated `/api/docs/*` control-plane API

固定拆分：

- Rspress/static reader assets
  - reader content
  - outline / section tree
  - public current / admitted historical 版本的 published reader payload
  - gated reader bootstrap route 与 controlled static asset package；正文读取仍必须经过
    same-origin app-api resolve/admission
- `/api/docs/*`
  - restricted / gated current version pointer
  - restricted / gated version list
  - restricted / gated docs search
  - restricted / gated citation/source-card permalink resolve
  - restricted admission

当前 campus-web implementation posture：

- `apps/campus-web` 通过 Rspress build 生成 docs route assets
- Vite/Worker 仍是 campus-web product shell 与 API proxy owner
- `/docs/*` 优先交付 Rspress-built reader HTML；未 materialize 的 docs route 才回到
  React docs shell 的 explicit error/empty path
- React `DocsPage` 不再承担自研 reader/search；它只处理未命中 static reader route 时的
  restricted / gated resolve handoff 或明确错误
- `/api/docs/*` 继续经 campus-web Worker Service Binding 进入 `app-api`
- unknown `/api/*`、operator APIs 与 generic app-api proxy 继续 fail closed

published reader asset package 与 deploy-time sync 的正式 contract 统一看
`docs/contracts/document-reader-publish-contract.md`。

## Route And URL Model

长期 reader permalink 语义固定为：

- 当前版：
  - `/docs/:corpus/:collection/:docSlug`
- 指定版本：
  - `/docs/:corpus/:collection/:docSlug/v/:versionSlug`
- 段落定位：
  - `#<anchor>`
- 临时高亮：
  - `?hl=<rootUnitId1>,<rootUnitId2>`

固定规则：

- 无版本路径的 URL 永远表示当前默认可见版本
- 历史版本必须显式进入 `/v/:versionSlug`
- `anchor` 表示稳定导航位置
- `hl` 只表示一次跳转的高亮意图，不承担版本选择或权限表达
- source card 与 docs search result 必须直接生成 reader permalink

## Source Card And Citation Jump Model

chat 的来源展示长期必须采用：

- browser-safe structured source cards
- reader permalink jump target

而不是：

- assistant prose 内联 raw locator
- 原始 `doc_id#chunk_id`
- source bucket key
- provider/source-truth snippet dump

固定规则：

- assistant 正文继续只承载用户可读答案
- source card 显式展示 canonical 文档名、章节名、命中摘要、版本语义与跳转目标
- 跳转目标固定落到 `/docs/*` + `?hl=` + `#anchor`
- operator trace 可以保留 compact raw retrieval/source-unit identity，但不进入 browser
  contract

## Search Model

docs search 与 chat 继续是两条不同能力：

- docs search
  - 返回 document / section / paragraph 命中
  - 目标是帮助用户进入 reader
- chat
  - 返回 synthesis answer
  - 目标是回答问题，并在需要时附 source cards

固定约束：

- public published docs search 默认使用 Pagefind static index；需要 principal / entitlement
  裁剪的 restricted / gated docs search 才进入 `/api/docs/*`
- 当前已实现的 `/api/docs/*` search 仍是 public current only，不作为公开文档站热路径；
  真正开放 restricted / gated search 前必须补 principal-aware visible search 与 entitlement
  裁剪测试
- docs search 结果必须直接回链 reader permalink
- docs search 不返回 raw retrieval trace
- docs search 不负责返回整篇正文
- chat 不能替代 docs 站导航、目录、版本入口与系统性阅读

## Visibility And Authorization

长期 public / restricted 文档阅读必须共用同一 reader model，而不是维护两套 reader 真相。

固定规则：

- canonical authz truth 仍在 `app-api`
- reader 与 chat retrieval 必须消费同一 visibility / version truth
- 不允许出现 “reader 不可见但 chat 可答” 的泄露面
- restricted collection 未 admission 时只能 fail closed，不得用前端隐藏代替 origin-side
  enforcement
- restricted reader 可以与 public reader 共用同一 reader asset format，但 delivery mode
  不得伪装成匿名 public static path

## Retired Surface Posture

`apps/public-docs` 的旧 Rspress 实现中，以下资产可以迁移或参考：

- published reader asset -> MDX generator
- `data-root-unit-id` DOM projection
- reader state enhancer
- docs search result -> reader permalink suggestion mapping
- Rspress theme ideas

但 `apps/public-docs` 不再承担：

- forward product entry
- docs browser surface ownership
- staging/product acceptance target
- OAuth/account/browser navigation owner

## Forbidden Shapes

- 不把文档站恢复为独立 `public-docs` product surface
- 不把 `campus-web` React 页面扩成完整自研 docs reader
- 不把 docs reader 做成直连数据库或直连 index 的第二后端
- 不把 raw chunk / source-truth / provider artifact 暴露给用户阅读面
- 不把 citation URL 绑定到当前 chunk 切分策略
- 不把 public 和 restricted 文档分别实现为两套 reader contract
- 不把 docs search 与 chat answer 混成同一 API / 同一 UI 真相

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/app-api-http.md`
- `docs/decisions/adr-0051-campus-docs-rspress-reader-surface.md`
