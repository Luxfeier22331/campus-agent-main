---
doc_type: contract
owner_boundary: docs/contracts
status: active
---

# 文档阅读器发布合同

## 文档边界

本文定义规范文档阅读器静态资源的发布合同。

它回答的是：

- 已发布阅读器资产保存在哪里；
- 对象存储中的阅读器发布包使用什么对象路径；
- `campus-web` 文档构建如何消费 `app-api` 导出的清单和阅读器资产；
- 公开、受限和历史版本如何分开交付。

它不负责：

- Rspress 主题和像素级实现；
- 文档搜索与引用接口细节；
- 某个部署脚本的全部命令行参数；
- 对象存储供应商的账号和凭据。

补充约束：

- 规范数据链以
  `docs/architecture/system/data-plane.md` 为准
- 文档站产品分层以
  `docs/architecture/system/document-site.md` 为准
- 浏览器文档接口以
  `docs/contracts/app-api/document-reader.md` 为准

## 核心结论

published reader assets 的长期语义固定拆成两层：

- 对象存储发布事实；
- campus-web 静态资产交付副本。

这意味着：

- 对象存储是长期 publish artifact owner
- `campus-web` 的 Rspress build/static assets 只是发布期复制品
- repo `assets/` 目录或源码目录下的静态文件不承担长期 reader truth
- 旧 `apps/public-docs` 不再是 forward product surface，且已从 active workspace 删除；
  历史脚本只能通过 git history 追溯

## 发布事实来源

reader asset package 的真相源固定为：

```text
规范文档产物
-> 阅读器投影
-> 对象存储中的阅读器资源包
```

固定规则：

- reader asset package 属于 derived artifact
- 它必须落在 `S3-compatible object storage`
- 它不得以 repo 内 `assets/` 目录替代
- deploy 过程可以生成本地 staging 目录，但 staging 目录必须是 gitignored 临时产物

## 对象存储键布局

reader asset package 固定落在现有 document prefix 之下，不新增一套平行文档身份路径。

长期 object key 形态固定为：

- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/reader.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/outline.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/meta.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/asset-manifest.json`

必要时允许在同一 `reader-assets/` 目录下增加 reader supplement，例如：

- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/course-maps.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/reader-assets/course-maps/<block-id>.png`

说明：

- 这组对象与 `canonical.md`、`document-units.jsonl` 同属同一 document version prefix
- `reader-assets/` 表示该版本的 reader-facing published artifact family
- `year` 继续服从现有 derived document key 规则，不额外再塞一层 `version_slug`

## 阅读器资产包结构

每个 document version 的最小 package 固定包括：

- `reader.json`
  - section / block 正文 payload
- `outline.json`
  - outline / section tree
- `meta.json`
  - 文档标题、来源摘要、页码范围、版本标签、更新时间、reader permalink 语义
- `asset-manifest.json`
  - package 内文件清单、hash、content type、size、reader permalink 元数据

按产品需要可以追加 supplement asset，但必须满足：

- 仍然落在同一 document version prefix 的 `reader-assets/` 下
- 语义属于 reader-facing supplement，而不是新的 canonical truth layer
- 不把 repo tracked `assets/` 目录变成 publish truth

固定规则：

- `reader.json` / `outline.json` / `meta.json` 是发布对象
- `asset-manifest.json` 是 package 自描述清单
- browser URL 不直接暴露 object key
- browser-facing reader route 来自 campus-web Rspress/static build，而不是对象存储路径
- browser-facing `meta.json` 不得暴露 raw source-truth locator、provider artifact path、
  object storage bucket/key 或 chunk id
- `docId` / `versionId` 是 control-plane identity，不是学生侧阅读 UI 字段；Rspress
  reader 默认不得把它们渲染到正文、来源详情或版本控件里
- browser-facing route target 统一称为 reader permalink；既有 payload 中的
  `canonicalUrl` 字段名只表示兼容字段，不表示 SEO canonical URL。

## 部署同步合同

campus-web docs deploy pipeline 固定走：

```text
app-api 文档读取模型
-> 部署同步 manifest
-> 从对象存储读取
-> campus-web 生成文档与静态目录
-> 部署 campus-web Worker 静态资源
```

这里固定拆成两个输入：

- 部署同步清单
  - 来自 app-owned control-plane truth
  - 负责声明“这次应发布哪些 public/admitted reader assets”
- 对象存储阅读器资产包
  - 提供真正的 bytes

补充解释：

- 对象存储输入只存在于 publish/build/deploy pipeline
- `campus-web` browser runtime 不直连对象存储
- browser 运行时只读取：
  - 同源 `/api/docs/*` 控制接口
  - 部署同步到 `/_docs/...`、`/_gated-docs/...` 的静态资产
  - Rspress 构建的 `/docs/*` 阅读器页面

固定规则：

- deploy sync manifest 不由前端扫描对象存储自行猜测
- deploy sync manifest 只列出本次允许交付的 reader assets
- deploy 时把 object storage 里的对象复制到本地 gitignored 生成目录，再交给
  campus-web build / Wrangler 上传
- 本地生成目录只承担 deploy staging，不承担长期真相
- docs shell 不把对象存储当运行时数据源

## 部署同步清单结构

当前 `app-api` 通过 `export-docs-reader-sync-manifest.ts` 导出文档阅读面发布
manifest；命令环境变量为 `DOCS_READER_SYNC_MANIFEST_PATH`。旧 public-docs 导出脚本名和
对应环境变量不再是入口，也不重新定义已删除 `apps/public-docs` 的任何产品职责。
`campus-web` 同步发布 reader 时必须通过 `--manifest-path` 或 `--manifest-key` 显式选择
manifest，不再消费 `CAMPUS_DOCS_SYNC_MANIFEST_*` runtime env。

deploy sync manifest 的最小逻辑形态固定为：

```json
{
  "surface": "public_docs",
  "generatedAt": "2026-04-21T10:00:00.000Z",
  "entries": [
    {
      "corpus": "curriculum",
      "collection": "curriculum_plan",
      "docId": "curriculum:law-ethnic-class-program",
      "versionId": "ver_2026_01",
      "documentSlug": "law-ethnic-class-program",
      "versionSlug": "2026-current",
      "title": "法学（民族班）本科人才培养方案",
      "deliveryMode": "public_static_asset",
      "sourceObjects": {
        "reader": "curriculum/documents/curriculum_plan/law-ethnic-class-program--abc12345/current-effective/2026/reader-assets/reader.json",
        "outline": "curriculum/documents/curriculum_plan/law-ethnic-class-program--abc12345/current-effective/2026/reader-assets/outline.json",
        "meta": "curriculum/documents/curriculum_plan/law-ethnic-class-program--abc12345/current-effective/2026/reader-assets/meta.json",
        "manifest": "curriculum/documents/curriculum_plan/law-ethnic-class-program--abc12345/current-effective/2026/reader-assets/asset-manifest.json"
      },
      "targetObjects": {
        "reader": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
        "outline": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
        "meta": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/meta.json",
        "asset-manifest": "_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/asset-manifest.json"
      }
    }
  ],
  "searchUnits": [
    {
      "searchUnitId": "search_curriculum_law_ethnic_class_program_general",
      "corpus": "curriculum",
      "collection": "curriculum_plan",
      "docId": "curriculum:law-ethnic-class-program",
      "documentSlug": "law-ethnic-class-program",
      "versionId": "ver_2026_01",
      "versionSlug": "2026-current",
      "documentTitle": "法学（民族班）本科人才培养方案",
      "title": "培养目标",
      "snippet": "本专业培养德智体美劳全面发展的法学人才。",
      "canonicalUrl": "/docs/curriculum/curriculum_plan/law-ethnic-class-program#general",
      "anchor": "general",
      "highlightRootUnitIds": ["unit_general_001"]
    }
  ]
}
```

固定规则：

- 当前 `surface` 字段仍为历史 wire value `public_docs`；它只标识现有 sync
  manifest schema，不再表达 forward browser product surface。
- `sourceObjects.*` 使用对象存储 key，而不是外部 URL
- `targetObjects.*` 使用 campus-web static assets 内的相对路径
- `searchUnits[]` 是发布 reader 的搜索投影输入；public current reader 用它生成
  Rspress local search metadata，`gated_asset` current reader 用它生成
  `/_gated-docs-search/*/index.json`
- `searchUnitId` 在 manifest 内必须唯一
- `canonicalUrl` 必须是 reader canonical path 加 anchor，例如
  `/docs/<corpus>/<collection>/<documentSlug>#<anchor>`；运行时 protected search
  index 只交付去掉 hash 的 same-origin `/docs/...` path，anchor 单独进入 `anchor`
- `highlightRootUnitIds[]` 只能引用 reader asset 中存在的 root unit
- `corpus`、`collection`、`documentSlug`、`versionSlug` 是 build-time 生成
  reader asset 与 reader page 的必要身份字段；`documentSlug` 不要求可直接作为
  browser route 文件名
- `campus-web` 生成公开 Rspress reader page 时，可为不适合作为静态文件名的
  `documentSlug` 派生 URL-safe route slug；派生 route slug 只用于 browser route、Rspress
  source 文件名和 search permalink，reader meta / admission / version API 仍使用原始
  `documentSlug`
- `title` 是 build-time 生成 reader page 与 navigation label 的必要用户可见字段
- `targetObjects` 必须包含 `asset-manifest`，deploy sync 用它校验 package 内对象的
  hash 与 size
- deploy pipeline 只能按 manifest 明确复制，不得目录级盲拷

## 交付模式

reader asset package 的 content format 可以统一，但 delivery mode 必须显式区分：

- `public_static_asset`
  - 允许进入 campus-web anonymous static delivery
- `gated_asset`
  - 只允许进入 campus-web Worker-first controlled delivery；可生成无正文 Rspress
    bootstrap route，但正文 bytes 必须经 same-origin `app-api` resolve/admission 后读取
- `withheld`
  - 已有 package，但当前不参与任何 reader delivery

固定规则：

- public current 文档默认走 `public_static_asset`
- admitted historical 文档只有在显式允许时才进入 `public_static_asset`
- restricted 文档默认不能进入匿名 static bundle
- `gated_asset` 可以与 public 使用同一 asset format，但不能共用同一路径曝光模型
- `gated_asset` 不进入匿名 collection index；可见目录与搜索结果必须来自
  `app-api` navigation/search control-plane
- `gated_asset` 的默认交付路径固定为 same-origin controlled delivery，而不是对象存储
  presigned URL
- `gated_asset` 返回给 browser 的 URL 应保持在 `campus.muc.wiki` /
  `campus-staging.mucwiki-edge.link` origin 下
- 当前交付层必须先完成逐请求 `app-api` 授权校验，再读取受限静态资源
- short-lived grant token / local verification 不属于默认 contract
- direct presigned URL 只允许作为 explicit exception，不作为默认 contract

## 部署工作目录

deploy 期间允许在 repo 内生成临时目录，例如：

- `apps/campus-web/docs/docs/...`
- `apps/campus-web/public/_docs/...`
- `apps/campus-web/public/_docs-static/...`
- `apps/campus-web/public/_gated-docs/...`
- `apps/campus-web/doc_build/...`

固定规则：

- 这些目录必须 gitignored 或只包含可重复生成的 neutral scaffold
- 这些目录只作为 build/deploy staging，不作为长期真相
- 不允许手工把 object storage publish artifact 复制进 repo tracked `assets/`

## 校验门槛

deploy sync 前必须至少验证：

- manifest 中所有 object key 都存在
- `asset-manifest.json` 的 hash / size 与 source object 一致
- target path 不发生冲突
- 当前发布子集满足 campus-web static assets 平台限制
- `gated_asset` / `withheld` 没有误入 anonymous static bundle
- Rspress build 能生成 `/docs/*` reader pages
- Rspress runtime JS / CSS / public local search index 只交付在
  `/_docs-static/*`，不占用 `/static/*`
- campus-web Worker 只显式代理 `/api/docs/*`，不开放 generic `/api/*`
- manifest 中 `searchUnits[].searchUnitId` 不重复
- `gated_asset` current entries 必须能找到对应 `searchUnits[]`
- protected search unit 的 `canonicalUrl` 必须匹配生成的 reader route
- protected search unit 的 `anchor` 与 `highlightRootUnitIds[]` 必须存在于 reader asset

## 禁止形态

- 不把 repo `assets/` 目录当长期 publish truth
- 不让前端在 deploy 时自行遍历对象存储决定公开哪些文档
- 不把 object storage key 暴露成 browser URL
- 不把 restricted reader 的默认交付退化成 browser 直连对象存储 endpoint
- 不把 restricted reader package 混进匿名 static bundle
- 不把 deploy staging 目录当长期缓存或人工维护目录
- 不把 `apps/public-docs` 重新作为独立文档产品入口

## 相关稳定文档

- `docs/architecture/system/document-site.md`
- `docs/contracts/app-api/document-reader.md`
- `docs/data/document-reader.md`
- `docs/architecture/system/data-plane.md`
- `docs/decisions/adr-0002-object-storage.md`
- `docs/decisions/adr-0051-document-site.md`
