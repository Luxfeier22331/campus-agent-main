---
doc_type: architecture
status: active
created: 2026-04-21
updated: 2026-04-27
---
# Document Site Architecture

## 文档边界

本文冻结 `campus-agent` 文档站与 canonical document reader 的前向 supporting architecture。

它回答的是：

- 文档站在长期产品里属于什么 browser surface
- `public-docs`、`app-api`、published reader assets、canonical document model
  各自负责什么
- 为什么 canonical doc 正文应优先以静态 reader assets 交付，而不是每次都走 API 取正文
- chat 来源展示为什么必须跳回 canonical reader，而不是直接暴露 chunk / source-truth
- public / restricted document reader 长期如何共用同一 reader contract

它不负责：

- 当前 merged truth 是否已经存在 `public-docs`
- donor shell 的具体像素实现
- 某个 collection 的 split / cleanup / OCR / chunking 细节
- docs search 的底层检索算法选型

补充约束：

- 当前 accepted merged truth 仍以 `docs/architecture/current-architecture.md`
  为准；本文描述的是已接受的前向设计，不是当前已上线 surface
- canonical data-plane chain 仍以 `docs/architecture/system/data-plane-architecture.md`
  为准
- default current-serving / explicit historical query 规则仍以
  `docs/architecture/system/retrieval-serving-architecture.md` 与
  `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md` 为准

## Core Conclusion

长期上，文档站应被建模为：

- docs-first browser surface
- canonical document reader
- published reader assets
- chat 来源跳转目标

而不是：

- PDF 阅读器
- raw chunk viewer
- source-truth browser
- 第二套 product backend

长期主链路固定为：

`browser -> public-docs static reader assets`

`browser -> public-docs same-site /api/docs/* -> app-api`

`browser -> public-chat-web -> app-api -> execution-control`

这意味着：

- 文档站与 chat 是两条独立 browser surface
- `public-docs` 既是 docs shell，也是静态 reader asset 的交付面
- `app-api` 继续是 shared product/auth/visibility owner
- chat 回答与 docs 阅读都只能消费 canonical reader truth，不能各自拼一套来源语义
- docs control plane 与 reader content delivery 必须分层

当前 Worker delivery truth：

- `apps/public-docs` 通过 Wrangler `[[services]] APP_API -> app-api` 调用 shared
  `apps/app-api`
- staging 通过 `APP_API -> app-api-staging` 与
  `APP_API_BASE_URL=https://app-api.internal` 形成同一 Service Binding request
  construction contract
- Worker 只代理 `/api/docs/*`；其他 `/api/*` fail-close，不把 public-docs 变成通用
  product backend
- `APP_API_BASE_URL` 只用于构造传给 Service Binding 的 `Request` URL；browser 仍不直接调用
  app-api public docs endpoint 或 app-api custom domain

补充约束：

- 文档站是产品中的一个独立入口集合，不是整个产品的默认总入口
- docs shell 的首页、collection landing 与 reader 导航，只表达 docs surface 自己的 IA
- repo 级顶层入口架构必须在更高一层产品文档中表达，不能反向由 docs shell 局部结构定义

## Browser Surface Model

### `apps/public-docs`

长期负责：

- docs landing / collection navigation
- canonical document reader shell
- published reader assets delivery
- docs search UI
- version switcher
- source-card jump target presentation

长期不负责：

- canonical auth/session/principal ownership
- retrieval visibility 判定
- raw chunk/source-truth 解释
- search / citation 的最终真相解析

固定 delivery posture：

- public、已发布、已 admission 的 reader content，优先以 Worker static assets 直接交付
- docs shell 继续通过 same-site `/api/docs/*` 读取 control-plane truth
- restricted 或未 admission 的 reader content，不得因为“已经静态化”就绕过 origin-side gate

### `apps/app-api`

长期负责：

- reader admission
- canonical visibility / authz resolution
- current-vs-historical version resolution
- published reader asset resolution
- docs search runtime APIs
- citation target resolution
- chat source-card payload shaping

长期不负责：

- docs shell layout 细节
- raw provider/source-truth 可视化

## Canonical Reader Model

reader 只允许建立在 canonical document truth 之上。

固定链路为：

`source truth -> declared projections -> canonical document artifacts -> reader
projection -> published reader assets`

`source truth -> declared projections -> canonical document artifacts ->
document-units -> chunks -> index`

这里的硬约束是：

- reader projection 与 retrieval index 可以共用 canonical document truth，但不能互相冒充
- published reader assets 来自 canonical reader projection，而不是来自 chunk payload
- public docs 正文不应在每次请求时经 `app-api` 重新返回
- reader 不直接读取 Qdrant / chunk payload
- reader 也不直接读取 source-truth/page manifest/provider artifact
- 用户可见定位固定依赖 canonical `anchor` 与 `root_unit_id`，而不是 `chunk_id`

## Reader Source And Version Metadata

来源与版本展示是 canonical reader shell 的正式能力。

固定规则：

- 每篇 reader detail page 必须在标题下、正文前展示用户可读的文档信息
- 用户可见字段只表达文档集合、来源文件或来源标题、原文页码、版本标签与当前展示状态
- `doc_id` / `version_id` 等技术身份只允许放入折叠技术详情或 operator trace
- browser-facing reader 不暴露对象存储 bucket/key、provider artifact path、raw
  source-truth locator 或 chunk id
- 课程地图、流程图等 reader supplement 继承同一文档级来源与版本语义，只补充局部页码来源
- 当前 Rspress 静态站可以在 deploy-time sync 阶段把 metadata 注入页面；长期同一语义应来自
  `reader-assets/meta.json`

## Static Asset Delivery Model

canonical doc 的正文交付长期采用：

- published static reader assets
- control-plane API

固定拆分如下：

- static reader assets
  - reader content
  - outline / section tree
  - public current / admitted historical 版本的 published reader payload
- control-plane API
  - current version pointer
  - version list
  - docs search
  - citation/source-card target resolve
  - restricted admission
  - future `historical / as_of / compare` capability routing

固定来源规则：

- published reader assets 的长期真相源在对象存储
- `public-docs` static assets 只是 deploy-time sync 复制品
- repo tracked `assets/` 目录不承担长期 reader publish truth
- browser/runtime 不直连对象存储；docs shell 运行时只消费 same-site `/api/docs/*` 与
  `public-docs` 自己交付的 `/_docs/...`、`/_gated-docs/...` 静态路径
- 对象存储只属于 publish/deploy pipeline 输入，不属于 browser-facing dependency

当前 `apps/public-docs` 的 deploy-time 资产目录为 `doc_build/`，Worker `ASSETS`
binding 负责交付静态 reader shell / assets；动态 docs control-plane 请求通过 same-site
`/api/docs/*` 进入 `app-api`，且 response 默认 `no-store`。

restricted reader 的当前实现约束：

- `public-docs` 会同步 `gated_asset` 到 `doc_build/_gated-docs/...` 静态路径
- `/_gated-docs/*` 采用 Worker-first：先调用 `app-api`
  `/api/docs/.../admission`，通过后才读取 `ASSETS`
- admission 非 204 时必须 fail-close，不返回正文 bytes
- gated 交付 response 默认 `Cache-Control: no-store` 且 `Vary: Cookie, Authorization`
- `app-api` 只负责 admission/control-plane，不再承担 gated bytes streaming
- 不得使用 presigned URL 作为默认交付路径

Cloudflare Workers 当前官方 static assets 路由模型允许：

- 命中静态资源时直接由 assets 层返回
- 未命中时再进入 Worker 代码
- 对指定路由显式 `run_worker_first`

这是本文选择 “正文静态发布 + `/api/docs/*` 控制面” 的直接平台依据。

reader asset package 与 deploy-time sync 的正式 contract 统一看
`docs/contracts/document-reader-publish-contract.md`。

当前 Phase 2 的 deploy-time 收口链路固定为：

- `canonical artifacts -> ingestion reader publisher`
  `-> reader-assets/* + docs read-model manifest`

- `docs read-model manifest -> app-api docs.* read model`
  `-> public docs sync manifest`

- `public docs sync manifest + object storage reader-assets/*`
  `-> public-docs Rspress source + /_docs static assets`

说明：

- `public-docs` 不扫描对象存储决定公开子集
- `public-docs` 的 source page generation 是 build-time consumption，不是新的
  canonical truth
- `app-api` 的 docs read model 是 public subset、delivery mode、version 与 search
  target 的 browser-facing control-plane owner
- `sync-real-docs` 只保留为过渡/手动工具，不是默认 deploy path

## Route And URL Model

长期 canonical route 语义固定为：

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
- public current / admitted historical URL 应尽量落到可缓存的静态 reader asset

## Source Card And Citation Jump Model

chat 的来源展示长期必须采用：

- browser-safe structured source cards
- canonical reader jump target

而不是：

- assistant prose 内联 raw locator
- 原始 `doc_id#chunk_id`
- source bucket key
- provider/source-truth snippet dump

固定规则：

- assistant 正文继续只承载用户可读答案
- source card 显式展示 canonical 文档名、章节名、命中摘要、版本语义与跳转目标
- 跳转目标固定落到 canonical docs URL + anchor + highlight
- operator trace 继续保留 compact raw retrieval/source-unit identity，但这不进入
  browser-facing contract

## Search Model

docs search 与 chat 继续是两条不同能力：

- docs search
  - 返回 document / section / paragraph 命中
  - 目标是帮助用户进入 reader
- chat
  - 返回 synthesis answer
  - 目标是回答问题，并在需要时附 source cards

固定约束：

- docs search 结果必须直接回链 canonical reader
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

长期 public / restricted 文档阅读必须共用同一 reader model，而不是维护两套 reader 真相。

固定规则：

- canonical authz truth 仍在 `app-api`
- reader 与 chat retrieval 必须消费同一 visibility / version truth
- 不允许出现 “reader 不可见但 chat 可答” 的泄露面
- restricted collection 未 admission 时只能 fail-close，不得用前端隐藏代替 origin-side
  enforcement
- restricted reader 可以与 public reader 共用同一 reader asset format，但 delivery mode
  不得等同于 public static assets direct-hit
- `gated_asset` 的默认 delivery posture 固定为 same-site controlled proxy：
  - browser 继续只请求 `public-docs` same-site URL
  - `public-docs` 在服务端向 `app-api` 做逐请求 authz 校验
  - 校验通过后再从对象存储受控读取并返回 asset bytes
- first-launch / v1 默认继续采用逐请求实时校验，不先引入 grant token 本地验签
- `presigned URL` 不是默认 restricted delivery 方案；只有 future optimization 明确被
  admission 时才允许作为受控补充，而不是主路径
- short-lived grant token 只作为 future optimization 预留，不作为当前默认 restricted delivery
  contract
- 独立 restricted docs surface 不是 first-launch 默认形态；只有当 restricted rollout 真正打开并需要
  product-level surface split 时才考虑

## Donor Posture

donor shell 的借鉴方向固定为：

- 信息架构与产品形态借鉴成熟 docs-first 产品
- 视觉与交互可借鉴成熟 docs shell

但 repo 继续保持以下 ownership：

- canonical document truth
- reader contract
- authz / visibility
- citation jump contract

因此：

- 不把外部 docs 平台当成 canonical truth owner
- 不把 static-site content pipeline 误当成 document registry / version truth
- 不把 “正文静态化” 误解成 “docs 不再需要 app-api control plane”

## Forbidden Shapes

- 不把文档站并入 `public-chat-web` 作为一个页面模式
- 不把 docs site 做成直连数据库或直连 index 的第二后端
- 不把 raw chunk / source-truth / provider artifact 暴露给用户阅读面
- 不把 citation URL 绑定到当前 chunk 切分策略
- 不把 public 和 restricted 文档分别实现为两套 reader contract
- 不把 docs search 与 chat answer 混成同一 API / 同一 UI 真相
- 不把 restricted reader 暴露成匿名可直读的 public static path

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
