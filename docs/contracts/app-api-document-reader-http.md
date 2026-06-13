---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-04-21
updated: 2026-06-12
---
# App API Document Reader HTTP Contract

## 文档边界

本文冻结 shared `apps/app-api` 对 `campus-web /docs/*` 暴露的 browser-facing docs
control-plane HTTP contract。

它回答的是：

- docs site 通过 same-site `/api/docs/*` 应读取哪些稳定 seam
- 哪些能力继续属于 control-plane API，哪些正文内容不应再由 API 每次返回
- restricted / gated docs search、version list、citation permalink、reader asset resolve
  各自返回什么
- chat source-card payload 应遵循什么最小 contract

它不负责：

- Rspress 主题、static asset routing 或部署方式
- docs shell 的 UI 细节
- `public-chat-web` 当前已上线消息 shape
- retrieval backend 的底层算法或存储实现

补充约束：

- 当前 `app-api` browser-facing 核心 contract 仍以 `docs/contracts/app-api-http.md`
  为准；本文是 docs site 的 forward contract
- restricted visibility 与 version mode 规则分别服从
  `docs/architecture/system/identity-and-authorization-architecture.md` 与
  `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`

## 适用范围

长期调用形态固定为：

- `browser -> campus-web /docs/* -> Rspress-powered reader assets`
- `browser -> campus-web same-origin /api/docs/* -> app-api`
- `campus-web Q&A source cards -> campus-web /docs/* reader permalink`

因此：

- browser 默认不直连 `app-api` public hostname
- docs surface 通过 `campus-web` Worker `APP_API` Service Binding 暴露 same-origin
  `/api/docs/*`
- proxy 后的 contract 必须保持与本文一致
- public published reader 正文默认不应通过这些 API endpoint 逐次返回
- public published docs 的页面、目录、版本元数据与搜索默认在 build/deploy 时 materialize
  为 Rspress/static assets；只有 restricted / gated 场景需要运行时 `/api/docs/*`。

`campus-web` docs delivery rule：

- 只允许代理 `/api/docs/*`；不得把 `/api/chat/*`、operator APIs 或其他 app-api surface
  经 docs reader 暴露出去
- proxy response 必须默认 `Cache-Control: no-store`
- proxy 可以转发 `accept`、`content-type`、`cookie`、conditional cache
  headers 与 trace id 等最小必要 header；不得转发 spoofable origin / operator headers
  作为授权依据
- gated static reader 的逐请求 admission 仍由 `app-api` 决定，`campus-web` 不缓存或重建
  visibility truth

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- `corpus` / `collection` / `versionMode` 使用小写语义值
- control-plane contract 不返回 raw chunk payload、source bucket key、provider
  artifact path 或 raw retrieval trace
- public published reader content 默认由 static reader assets 承载，而不是由 `/api/docs/*`
  承载整篇正文
- current version 是默认语义；historical version 必须显式指定
- restricted admission 失败时直接 fail-close，不返回“伪装成不存在”的高亮内容片段
- `docId` / `versionId` 可以存在于 API payload，供 client 关联 control-plane 状态；
  默认学生侧 reader UI 不应展示这些内部 identity 字段
- 既有 response 中的 `canonicalUrl` 字段名暂时保留为 wire compatibility；它的语义是
  reader permalink，不是 SEO canonical URL，也不表示公开文档站运行时必须调用
  `app-api` 解析链接

## Endpoint Summary

- `GET /api/docs/readyz`
- `GET /api/docs/collections/:corpus/:collection/navigation`
- `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug`
- `GET
  /api/docs/collections/:corpus/:collection/documents/:documentSlug/versions`
- `GET
  /api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve`
- `GET
  /api/docs/collections/:corpus/:collection/documents/:documentSlug/admission`

## Docs Readiness Contract

### `GET /api/docs/readyz`

返回 document reader control-plane 自身的 readiness，不冒充整个 `app-api` 产品 runtime readiness。

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "database": "ready",
    "docsReadModel": "ready"
  }
}
```

固定规则：

- 该 endpoint 只表达 docs surface 真正依赖的控制面依赖
- 不把 execution-control readiness、chat runtime readiness、operator surface
  readiness 混入 docs readiness
- campus docs readiness smoke 应通过 same-origin bridge 调用这个 endpoint，而不是调用根
  `/readyz`
- 失败时返回 `503 dependency_not_ready`，message 固定为
  `Document reader control plane is not ready.`

## Navigation Contract

### `GET /api/docs/collections/:corpus/:collection/navigation`

返回 collection landing、文档树与导航节点。

```json
{
  "collection": {
    "corpus": "curriculum",
    "collection": "curriculum_plan",
    "displayName": "培养方案",
    "description": "当前开放的培养方案与阅读入口。"
  },
  "nodes": [
    {
      "kind": "document",
      "title": "法学（民族班）培养方案",
      "documentSlug": "law-ethnic-class-program",
      "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
      "isCurrent": true
    }
  ]
}
```

固定规则：

- navigation 只返回当前 principal 可见的节点
- navigation node 可承载 section shortcut，但不返回全文块内容

## Document Summary Contract

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug`

返回单篇 canonical document 的摘要信息，不返回全文 reader blocks。

```json
{
  "document": {
    "docId": "curriculum:law-ethnic-class-program",
    "title": "法学（民族班）培养方案",
    "documentSlug": "law-ethnic-class-program",
    "corpus": "curriculum",
    "collection": "curriculum_plan",
    "currentVersionId": "ver_2026_01",
    "currentVersionSlug": "2026-current",
    "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
    "updatedAt": "2026-04-21T10:00:00.000Z"
  }
}
```

## Version List Contract

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/versions`

返回 reader 可见的版本列表。

```json
{
  "document": {
    "docId": "curriculum:law-ethnic-class-program",
    "title": "法学（民族班）培养方案",
    "documentSlug": "law-ethnic-class-program"
  },
  "versions": [
    {
      "versionId": "ver_2026_01",
      "versionSlug": "2026-current",
      "label": "现行版",
      "isCurrent": true,
      "effectiveFrom": "2026-02-01"
    }
  ]
}
```

固定规则：

- first launch 即使只开放 current reader，也要返回稳定 `versionId` / `versionSlug`
- future historical rollout 只在这里扩 version list，不改 reader URL contract

## Reader Asset Resolve Contract

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve`

查询参数：

- `version`
  - 可选；缺省表示当前默认版本
- `anchor`
  - 可选；请求 reader 落位到某个稳定锚点
- `hl`
  - 可选；逗号分隔的 `rootUnitId` 列表，用于临时高亮

返回：

```json
{
  "document": {
    "docId": "curriculum:law-ethnic-class-program",
    "title": "法学（民族班）培养方案",
    "documentSlug": "law-ethnic-class-program",
    "corpus": "curriculum",
    "collection": "curriculum_plan",
    "versionId": "ver_2026_01",
    "versionSlug": "2026-current",
    "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
    "updatedAt": "2026-04-21T10:00:00.000Z"
  },
  "resolvedVersion": {
    "versionId": "ver_2026_01",
    "versionSlug": "2026-current",
    "label": "现行版",
    "isCurrent": true
  },
  "readerAsset": {
    "deliveryMode": "gated_asset",
    "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
    "contentUrl": "/_gated-docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
    "outlineUrl": "/_gated-docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json"
  },
  "readerState": {
    "anchor": "semester-4",
    "highlightRootUnitIds": ["semester-4-course-list"]
  }
}
```

固定规则：

- `resolve` 只返回 reader asset descriptor 与 state，不返回整篇正文
- `readerAsset.deliveryMode` 至少允许：
  - `public_static_asset`
  - `gated_asset`
- `anchor` 是稳定导航单位
- response 不返回 `chunkId`、`score`、`sourceUnitKey`、raw snippet dump
- `gated_asset` 的默认 URL 为 same-origin `/_gated-docs/*`，由 `campus-web` Worker-first
  校验后交付
- `gated_asset` 的 v1 delivery 默认要求 `campus-web` 逐请求向 `app-api` 做 authz 校验
- `gated_asset` 不应把对象存储 endpoint、presigned URL 或 bucket key 暴露给 browser
- `gated_asset` 可以拥有 Rspress bootstrap route，但正文必须通过 resolve/admission 后
  same-origin 读取；匿名 Rspress index 不得包含 gated 文档 title/slug
- short-lived grant token / local verification 不属于当前默认 contract
- future restricted delivery 可以继续使用同一格式，但 `deliveryMode` 不得伪装成匿名 public static
  path

## Gated Reader Admission Contract

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/admission`

查询参数：

- `version`
  - 可选；缺省时服务端按当前版本解析

固定规则：

- 该 endpoint 只服务 `gated_asset` admission，公开静态文档继续走 `campus-web` docs
  static assets
- 每次请求必须重新解析 principal 并校验 document version visibility / entitlement
- 授权通过返回 `204 No Content`
- response 必须设置 `Cache-Control: no-store` 与 `Vary: Cookie, Authorization`
- 授权失败、对象不存在或 projection 不可安全判定时 fail-close
- `campus-web` 必须在 Worker 内先调用 admission，再尝试读取 `/_gated-docs/*` 静态资产

## Restricted / Gated Docs Search Delivery Contract

browser-facing docs site 不再调用，app-api 也不再注册
`GET /api/docs/collections/:corpus/:collection/search`。公开 current 文档搜索由 Rspress
native local search 处理；受限文档搜索由 campus-web 交付 admission 保护的静态 index：

- `GET /_gated-docs-search/:corpus/:collection/:documentSlug/:versionSlug/index.json`

固定规则：

- campus-web Worker 必须先调用同一文档版本的 app-api admission endpoint。
- admission 失败、对象不存在或 projection 不可安全判定时 fail closed。
- response 必须设置 `Cache-Control: no-store` 与 `Vary: Cookie, Authorization`。
- browser 本地执行字面查询；用户查询词不发送到 app-api。
- index 只包含当前 principal 已被 admission 允许读取的同一文档版本 search entries。

静态 index payload：

```json
{
  "schemaVersion": "campus_docs_protected_search_index_v1",
  "visibilityMode": "principal_protected_static",
  "generatedAt": "2026-06-13T00:00:00.000Z",
  "entries": [
    {
      "searchUnitId": "semester-4-course-list",
      "documentTitle": "法学（民族班）培养方案",
      "sectionTitle": "第四学期",
      "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
      "anchor": "semester-4",
      "highlightRootUnitIds": ["semester-4-course-list"],
      "corpus": "curriculum",
      "collection": "curriculum_plan",
      "collectionLabel": "培养方案",
      "documentSlug": "law-ethnic-class-program",
      "versionSlug": "2026-current",
      "searchText": "法学（民族班）培养方案 第四学期 第四学期开设课程包括……",
      "snippet": "第四学期开设课程包括……"
    }
  ]
}
```

固定规则：

- docs search 的结果目标始终是 reader permalink
- docs search 不返回 synthesis answer
- docs search 不返回 operator-only compact source trace
- docs search 只返回 reader permalink，不返回正文资产本身
- `/api/docs/collections/:corpus/:collection/search` 不属于 app-api
  document reader HTTP contract，也不得被 campus-web Worker allowlist。

## Source Card Shared Payload

chat 与 restricted / gated docs search 共用如下最小 citation target 形态：

```json
{
  "type": "source_card",
  "documentTitle": "法学（民族班）培养方案",
  "sectionTitle": "第四学期",
  "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program?hl=semester-4-course-list#semester-4",
  "anchor": "semester-4",
  "highlightRootUnitIds": ["semester-4-course-list"],
  "snippet": "第四学期开设课程包括……",
  "versionLabel": "现行版"
}
```

固定规则：

- source card 是 browser-safe citation target，不是 raw retrieval trace
- assistant prose 不承载这些字段的字符串拼接版本
- `canonicalUrl` 是既有 wire 字段名，必须可直接落到 docs reader permalink
- source card 自身不承载整篇 reader payload

## Forbidden Shapes

- 不新增 `browser -> app-api` 的 docs public direct-call contract
- 不返回 raw `chunkId` / `sourceUnitKey` 作为用户跳转目标
- 不把 docs search 做成 chat answer API 的别名
- 不把 `resolve` 做成“每次返回整篇正文”的 reader API
- 不让 version 选择隐藏在自由文本 query 中
- 不让 campus docs shell 或 Rspress 自己解释权限或版本 truth

## 相关稳定文档

- `docs/contracts/app-api-http.md`
- `docs/architecture/system/document-site-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
