---
doc_type: architecture
truth_scope: product
owner_boundary: apps/campus-web
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
- docs control plane 与 reader content delivery 为什么必须分层

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
- Rspress 是 docs reader/render/search integration shell；公开文档搜索使用 Rspress
  native local search，受限文档搜索使用 admission 保护的静态 index；二者都不拥有
  canonical document truth
- `app-api` 继续拥有 docs publish manifest、restricted/gated navigation/search/resolve/version/
  admission truth
- published reader assets 是正文发布产物，不是新的 truth layer
- docs control plane 与 reader content delivery 必须分层
- Q&A source card、docs search result 与直接阅读必须落到同一 reader permalink
- 旧 `apps/public-docs` 不再是 forward product surface，且已从 active workspace 删除；
  历史 Rspress/MDX/anchor/highlight/search 管线只能通过 git history 追溯

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
- 搜索入口挂载、自定义 result path 与 reader permalink 集成

固定约束：

- Rspress 只能消费 canonical reader projection 或由它生成的 MDX
- Rspress frontmatter、route file 或 search index 不成为 document/version truth
- Rspress 原生 local search 是公开文档站搜索默认引擎；搜索索引只包含
  `docsSearchVisibility=public_current` 的 published reader pages
- 更换 reader engine 必须更新 ADR、contract tests 与 build gate

### Rspress Public Search Engine

长期负责：

- build-time anonymous-visible current docs local search index
- anonymous-visible docs browser-side exact / literal search execution
- Rspress search result 到 reader permalink 的候选映射

固定约束：

- Rspress local search 只索引 anonymous-visible current reader pages
- gated / restricted、bootstrap、collection index 与 historical `/v/*` 页面不得进入公开索引
- 公开搜索只做字面命中，不做同义词、别名、语义扩展或 RAG-style query rewrite
- principal-specific 可见文档搜索不得混入公开 Rspress index；当前采用受 admission 保护的
  per-document static index，并在 browser 本地执行查询
- browser-facing docs site 不调用 `/api/docs/collections/:corpus/:collection/search`

### Static Asset Delivery Constraints

固定约束：

- public、已发布、已 admission 的 reader content，优先以 campus-web Worker static assets
  直接交付
- docs shell 继续通过 same-origin `/api/docs/*` 读取 control-plane truth
- 未 admission 的 reader content，不得因为“已经静态化”就绕过 origin-side gate
- browser/runtime 不直连对象存储；对象存储只属于 publish/deploy pipeline 输入

### `apps/app-api`

长期负责：

- reader admission
- reader source / version resolution
- current-vs-historical version resolution
- published reader asset resolution
- restricted / gated docs search data truth 与 admission
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
  - `/docs/*` reader HTML
  - `/_docs-static/*` Rspress runtime JS / CSS / native local search index
  - `/_docs/*` public current / admitted historical 版本的 published reader payload
  - gated reader bootstrap route 与 controlled static asset package；正文读取仍必须经过
    same-origin app-api resolve/admission
- `/api/docs/*`
  - restricted / gated current version pointer
  - restricted / gated version list
  - restricted / gated docs search index admission 与 manifest resolution
  - restricted / gated citation/source-card permalink resolve
  - restricted admission
  - future `historical / as_of / compare` tool routing

当前 campus-web implementation posture：

- `apps/campus-web` 通过 Rspress build 生成 docs route assets
- Vite/Worker 仍是 campus-web product shell 与 API proxy owner
- `/docs/*` 优先交付 Rspress-built reader HTML；collection-level 或未 materialize 的 docs
  route 进入 React docs handoff
- React `DocsPage` 不承担自研全文 reader/search；它只处理 collection navigation、restricted /
  gated resolve handoff 或明确错误
- `/api/docs/*` 继续经 campus-web Worker Service Binding 进入 `app-api`
- unknown `/api/*`、operator APIs 与 generic app-api proxy 继续 fail closed
- published reader assets 的长期真相源在对象存储
- `campus-web` static assets 只是 deploy-time sync 复制品
- repo tracked `assets/` 目录不承担长期 reader publish truth
- browser/runtime 不直连对象存储；docs shell 运行时只消费 same-origin `/api/docs/*` 与
  `campus-web` 自己交付的 `/_docs-static/...` / `/_docs/...` /
  `/_gated-docs/...` 静态路径

Cloudflare Workers 当前官方 static assets 路由模型允许：

- 命中静态资源时直接由 assets 层返回
- 未命中时再进入 Worker 代码
- 对指定路由显式 `run_worker_first`

这是本文选择 “正文静态发布 + `/api/docs/*` 控制面” 的直接平台依据。

reader asset package 与 deploy-time sync 的正式 contract 统一看
`docs/contracts/document-reader-publish.md`。

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

chat source-card、docs search result 与 reader permalink 的人类语义统一由
`docs/domains/source-card.md` 承接。本文只冻结 document-site 侧的约束：

- reader permalink 必须落到 `/docs/*`，并使用 `?hl=` 与 `#anchor`
- source card 不得暴露 raw chunk、source bucket key 或 provider/source-truth payload
- operator trace 可以保留 compact raw retrieval/source-unit identity，但不进入 browser contract

## Search Model

docs search 与 chat 继续是两条不同能力：

- docs search
  - 返回 document / section / paragraph 命中
  - 目标是帮助用户进入 reader
- chat
  - 返回 synthesis answer
  - 目标是回答问题，并在需要时附 source cards

固定约束：

- anonymous-visible current docs search 默认使用 Rspress native local search
  - public local search index 随 Rspress runtime assets 交付在
    `/_docs-static/static/search_index*.json`
- restricted / gated docs search 默认使用 `/_gated-docs-search/*` 受保护静态索引，
  由 campus-web Worker 先调用 app-api admission，再交付 index；查询词不发送到 API
- `/api/docs/collections/:corpus/:collection/search` 已从 docs browser-facing HTTP
  contract 退役；不得作为 campus-web 或 browser search hook 的查询路径
- docs search 结果必须直接回链 reader permalink：`canonicalUrl?hl=rootUnitId#anchor`
- docs search 不返回 raw retrieval trace
- docs search 不负责返回整篇正文
- chat 不能替代 docs 站导航、目录、版本入口与系统性阅读

## Versioning And Historical Posture

版本规则继续服从 ADR-0014：

- reader 默认只打开当前有效版本
- historical / as_of / compare 必须显式化
- 版本选择必须发生在 retrieval / reader materialization 之前

对文档站的直接含义是：

- first launch 即使只开放 current reader，也必须把 `versionId` / `versionSlug` 纳入 contract
- source card target 从第一天起就必须携带版本语义
- 未来 compare / as_of 可以扩展为独立 view，但不能回退成 query-only 暗箱逻辑

## Visibility And Authorization

当前长期 reader model 只冻结 public docs / current reader 的 source、version 与
admission truth。

固定规则：

- canonical authz truth 仍在 `app-api`
- reader 与 chat retrieval 必须消费同一 visibility / version truth
- 不允许出现 “reader 不可见但 chat 可答” 的泄露面
- restricted collection 未 admission 时只能 fail closed，不得用前端隐藏代替 origin-side
  enforcement
- restricted reader 可以与 public reader 共用同一 reader asset format，但 delivery mode
  不得伪装成匿名 public static path
- 受限文档阅读只承诺当前已冻结的 gated reader/static index delivery；不得从本文推导出
  学生 / 教职工差异化 tool 权限、内部文件库或 legacy ACL rollout

## Retired Surface Posture

历史 `apps/public-docs` Rspress 实现中的以下资产已经迁移到 `campus-web /docs/*`，
后续只可通过 git history 追溯来源：

- published reader asset -> MDX generator
- `data-root-unit-id` DOM projection
- reader state enhancer
- docs search result -> reader permalink suggestion mapping
- Rspress theme ideas

已删除的 `apps/public-docs` 不再承担：

- forward product entry
- docs browser surface ownership
- staging/product acceptance target
- OAuth/account/browser navigation owner
- canonical document truth
- reader contract
- source / version / admission
- citation jump contract

因此：

- 不把外部 docs 平台当成 canonical truth owner
- 不把 static-site content pipeline 误当成 document registry / version truth
- 不把 “正文静态化” 误解成 “docs 不再需要 app-api control plane”

## Forbidden Shapes

- 不把文档站恢复为独立 `public-docs` product surface
- 不把 `campus-web` React 页面扩成完整自研 docs reader
- 不把 docs reader 做成直连数据库或直连 index 的第二后端
- 不把 raw chunk / source-truth / provider artifact 暴露给用户阅读面
- 不把 citation URL 绑定到当前 chunk 切分策略
- 不把 docs search 与 chat answer 混成同一 API / 同一 UI 真相
- 不把 gated / restricted reader 作为当前 public docs 默认交付形态

## 相关稳定文档

- `docs/architecture/current.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/retrieval-serving.md`
- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/identity-authz.md`
- `docs/contracts/app-api/document-reader.md`
- `docs/contracts/app-api/README.md`
- `docs/domains/source-card.md`
- `docs/decisions/adr-0051-campus-docs-rspress-reader-surface.md`
