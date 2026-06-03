---
phase: "2"
artifact: "research"
created: 2026-04-21
updated: 2026-04-23
status: completed
---

# Phase 2 Research

## Purpose

把 `Phase 2: Published Reader Assets And App API Docs Control Plane` 建立在三类事实之上：

- repo 已冻结的 document-site / data-plane / publish-contract truth
- 当前代码里 docs route shell、reader asset package 与正式 docs shell 已出现，但 runtime-backed service 与 shell consumption 仍未闭环的实现现实
- 当前仓库已经统一采用的前端 runtime 栈
- 官方产品/平台文档对 docs-first shell、static asset delivery、versioning 与 permission-aware AI/doc linking 的支持

## Repo Pattern Readings

- `.planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md`
- `.planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md`
- `docs/architecture/system/document-site-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/document-reader-publish-contract.md`
- `docs/data/canonical-document-reader-model.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `packages/ingestion-core/src/campus_ingestion_core/document_reader_assets.py`
- `apps/app-api/src/app/routes/docs.ts`
- `apps/app-api/src/modules/docs/index.ts`
- `apps/public-docs/package.json`
- `apps/public-docs/rspress.config.ts`
- `apps/public-docs/scripts/sync_real_docs.py`

## External Sanity-Check References

- Cloudflare Workers Static Assets
  - https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Static Assets binding / `run_worker_first`
  - https://developers.cloudflare.com/workers/static-assets/binding/
- Starlight project structure
  - https://starlight.astro.build/guides/project-structure/
- Starlight site search
  - https://starlight.astro.build/guides/site-search/
- Docusaurus versioning
  - https://docusaurus.io/docs/versioning
- GitBook AI Assistant
  - https://gitbook.com/docs/publishing-documentation/gitbook-ai-assistant
- ReadMe Ask AI
  - https://docs.readme.com/main/docs/ask-ai
- ReadMe versions
  - https://docs.readme.com/main/docs/versions

说明：

- 这些资料只用于 sanity-check 我们已经冻结的方向是否符合成熟 docs-first 实践。
- repo 内的 owner、phase 顺序和 canonical truth 仍以本地 architecture / contract / planning 文档为准。

## Findings

### 1. Cloudflare 的原生平台明确支持“静态正文 + Worker 控制面”的混合形态

- Workers Static Assets 官方文档明确支持同一应用同时交付静态资源和 Worker 逻辑。
- `run_worker_first` 官方文档说明可以为某些路径优先进入 Worker，而不是直接命中静态资源。
- 当前 repo 的 `public-chat-web` 与 `protected-panel-web` 已经都采用：
  - `React 19`
  - `Vite`
  - `@cloudflare/vite-plugin`
  - Worker-hosted static assets + same-site route shell

推论：

- `public-docs` 作为独立 Worker docs surface 是正确方向。
- docs 正文可以走静态资产交付。
- same-site `/api/docs/*` 仍可以保留在 docs surface 周边，而不必把 docs app 退化成“纯静态站 + 跨站 API”。
- 文档站没有必要为前端基线再引入一套与现有 surfaces 不同的 app runtime。

### 2. 当前已落地的 `Rspress` shell 是正式 docs app，但还不是长期 truth 的最终收口

- Starlight 官方文档的 project structure 仍以内容驱动 docs site 为中心。
- Starlight site search 官方文档明确 search provider 是可替换的。
- Docusaurus 官方文档把 versioning 作为正式能力。
- 当前 repo 已有 `public-docs` 正式 docs shell，并且公开聊天/受保护面继续都在 Worker web surfaces 上运行。

推论：

- `public-docs` 已经作为正式 app 存在；当前问题不再是“选什么前端壳创建它”，而是“如何把现有壳收口到长期 reader/control-plane truth”。
- 我们仍可以借 Starlight 或 Docusaurus 的 docs shell、IA、version navigation 结构。
- 但这些外部 docs frameworks 只承担参考，不承担 truth owner。
- canonical content / version / visibility truth 继续由 `app-api + object storage-backed publish pipeline` 持有。

补充解释：

- 这里不是说 browser runtime 要同时直连 `app-api` 和对象存储
- 正确拆分是：
  - docs shell 运行时消费 same-site `/api/docs/*` 与 `/_docs/...`
  - publish/deploy pipeline 消费 `app-api` truth 与对象存储 bytes

### 3. 版本是成熟 docs 产品的一等概念，不应留到 UI 后补

- ReadMe 官方文档也把 versions 作为产品级概念。

推论：

- `versionId` / `versionSlug` 从 `Phase 2` 起就必须进入 runtime seams。
- `resolve` / `versions` / `navigation` 的数据 shape 不能假设永远只有 current。
- 但 current URL 仍应保持最短 canonical path；historical selection 通过 control-plane 显式解析，而不是改变 reader truth owner。

### 4. 成熟的 AI + docs 形态都把回答建立在文档上，而不是替代文档

- GitBook AI Assistant 官方文档强调 assistant 可以基于当前页面上下文回答。
- ReadMe Ask AI 官方文档强调 hidden pages 不会被索引，并且只有用户有权访问的内容才会用于回答。

推论：

- 我们的 chat source-card 必须跳回 canonical reader，而不是把 raw retrieval trace 直接渲染给用户。
- docs search 与 chat citation target 共用 reader target 是正确方向。
- public / restricted reader 共用一套 payload/model，但 delivery mode 与 admission 必须分离。

### 5. `public-docs` 不应继续固化为第二个内容控制面

- 既有 repo 文档已经明确 `app-api` 是 shared application/control-plane backend。
- `official_web` 的 control-plane owner 也已经冻结在 `app-api`。
- 外部 docs frameworks 多是“站点层工具”，不承担我们这种 canonical registry + admission truth。

推论：

- `Phase 2` 的正确 owner 仍是：
  - `ingestion/data-plane` 生成 reader projection 与 published artifacts
  - `app-api` 暴露 docs control-plane
- `public-docs` 当前 shell 只是过渡实现；在 `Phase 2` 应优先接上长期 seams，而不是继续在前端长出一套自有 content loader。

## Recommended Decisions To Freeze

1. `public-docs` 作为正式 docs shell 继续保留当前技术基线；后续 phase 只做 convergence 与 IA 精修，不重开第二个 docs app。
2. `Starlight` / `Docusaurus` 只作为 docs IA / shell donor 参考，而不是 content truth owner。
3. docs search 的 truth owner 继续固定为 `app-api`，不把 Pagefind / client-side static search 提升为主搜索面。
4. reader asset publish 必须走：
   - canonical artifacts
   - reader projection
   - object storage package
   - app-owned deploy sync manifest
   - generated static bundle
5. `Phase 2` 的 smoke 子集推荐直接覆盖当前两条公开 query-enabled collection，而不是只做单 collection demo。

## Design Consequences For This Phase

- 要先补 reader projection generator，而不是先补 UI 组件。
- 要先补 `app-api` 的 runtime-backed docs service，而不是让既有 route shell 永远停留在 unavailable state。
- 要把 `public-docs` 切到 published reader assets + same-site docs seam，而不是继续直接同步公开文档产物。
- resolve/search 必须只返回 canonical jump target，不返回正文或 raw trace。
- `public_static_asset` 与 `gated_asset` 的 delivery mode 必须从第一版就显式区分。

## Open Decisions Left For User

以下不是 `Phase 2` blocker，但会影响后续 `Phase 3` 的 shell convergence：

1. 视觉 donor 要偏向：
   - `Starlight` 式文档外壳
   - 还是更强品牌化的自定义校园 docs shell
2. docs landing 的一级导航要偏向：
   - corpus/collection library
   - 还是面向任务入口的 curated landing

如果你不额外指定，我会默认：

- `Phase 3` 采用 `React + docs-first custom shell`
- 视觉上借鉴 `Starlight` / `Docusaurus` 的成熟结构，但不做原样照抄
- landing 先采用 corpus/collection library，后续再叠加任务入口
