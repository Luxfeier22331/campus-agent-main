---
doc_type: contract
owner_boundary: apps/app-api
status: active
---
# App API 文档阅读器接口

## 边界

本文定义 app-api 当前注册的文档导航、摘要、版本、资产解析和访问准入接口。接口不返回整篇正文、
原始检索结果或对象存储位置。Campus Web、Rspress 和静态资产交付见
`../../architecture/system/document-site.md`，发布格式见 `../document-reader-publish.md`。

## 通用规则

Campus Web Worker 为所有 `/api/docs/*` 请求设置内部 header：

```text
x-campus-docs-release: sha256:<64 lowercase hex>
```

浏览器提供的同名 header 必须被覆盖。header 缺失、格式非法或 release 尚未物化时返回
`503 docs_release_unavailable`。所有读取和就绪检查只使用该 release，不选择“最新”版本。

- JSON 字段使用 `camelCase`；
- `corpus`、`collection` 和版本参数使用小写语义值；
- 默认读取当前版本，历史版本必须显式指定；
- `canonicalUrl` 表示阅读器固定链接，不是 SEO canonical URL；
- 响应可以携带内部关联所需的 `docId` 和 `versionId`，普通学生界面不展示这些字段；
- 错误响应遵守 `error.md`。

## 接口清单

- `GET /api/docs/readyz`
- `GET /api/docs/collections/:corpus/:collection/navigation`
- `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug`
- `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/versions`
- `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve`
- `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/admission`

## 就绪状态

### `GET /api/docs/readyz`

只检查文档接口依赖的认证、数据库和读取投影：

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

依赖不可用时返回 `503 dependency_not_ready`，message 为
`Document reader control plane is not ready.`。

## 导航

### `GET /api/docs/collections/:corpus/:collection/navigation`

返回当前用户可见的集合信息和导航节点，不返回正文：

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

节点可以包含章节快捷入口，但不能包含全文块。

## 文档摘要

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug`

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

该接口只返回文档摘要，不返回阅读器正文。

## 版本列表

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/versions`

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

即使只开放当前版本，也必须返回稳定的 `versionId` 和 `versionSlug`。

## 资产解析

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve`

可选查询参数：

- `version`：指定版本；缺省时读取当前版本；
- `anchor`：稳定章节锚点；
- `hl`：逗号分隔的 `rootUnitId`，用于临时高亮。

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

`deliveryMode` 当前允许 `public_static_asset` 和 `gated_asset`。响应只给出阅读器资产描述与状态，
不返回正文、检索分数、分块标识、对象存储地址或预签名 URL。

## 受限文档准入

### `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/admission`

可选 `version` 查询参数；缺省时按当前版本解析。该接口只用于 `gated_asset`：

- 每次请求重新解析用户并校验文档版本可见性；
- 允许读取时返回 `204 No Content`；
- 响应设置 `Cache-Control: no-store` 和 `Vary: Cookie, Authorization`；
- 无权限、对象不存在或读取投影无法可靠判断时拒绝访问；
- Campus Web 必须先完成准入，再读取对应的受限静态资产。

## 相关文档

- `README.md`
- `../../architecture/system/document-site.md`
- `../document-reader-publish.md`
- `../../data/document-reader.md`
- `../../domains/source-card.md`
- `../../decisions/adr-0014-document-history.md`
