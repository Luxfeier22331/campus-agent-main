---
phase: "2"
name: "Published Reader Assets And App API Docs Control Plane"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 2 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 把 canonical document layer 产出成正式的 reader projection 与 published reader assets
- 把 `app-api` 的 docs navigation / document summary / version list / resolve / search seams 做成 runtime truth
- 固定 public static bundle、gated asset 与 future restricted/historical delivery 的第一层分发边界
- 为 `Phase 3` 的 `public-docs-web` shell 提供稳定可消费的 `/api/docs/*` 与 `/_docs/...` 契约

它不负责：

- `public-docs-web` 的视觉 donor shell 或 IA 细节
- docs landing、reader layout、breadcrumb、outline 交互
- chat source-card UI 改造
- restricted surface 的完整 acceptance 或 staging smoke
- docs search 的底层排序算法优化

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已完成并冻结：
  - `public-docs-web` 是独立 browser surface
  - `app-api` 是 docs control-plane owner
  - canonical reader model 使用 `anchor + rootUnitId`
  - published reader assets 的长期真相固定在对象存储
  - chat/source-card/docs search 必须共用 canonical reader target
- repo 已有 reader asset key builder：
  - `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- repo 已把 `reader-assets/*` object key 规则写入：
  - `docs/contracts/document-reader-publish-contract.md`
  - `docs/decisions/adr-0002-local-minio-conventions.md`
- repo 目前还没有：
  - `apps/public-docs-web`
  - reader projection generator
  - published reader asset publish pipeline
  - `app-api` docs HTTP routes/service/store
  - browser-safe canonical source-card runtime payload

</current_truth>

<decisions>
## Implementation Decisions

- **02-01:** `Phase 2` 的第一 owner 是 `canonical document artifacts -> reader projection -> published reader assets` 这条 delivery 子链，不是前端 donor shell。
- **02-02:** reader projection 必须从 canonical document layer 生成；允许复用 `canonical.md`、`document-units.jsonl` 与 registry metadata，但不得从 retrieval chunks 或 search hit snippet 反推正文。
- **02-03:** `app-api` 必须成为以下 docs truth 的 runtime owner：
  - collection navigation
  - document summary
  - version list
  - reader resolve
  - docs search result target
  - deploy sync manifest / published asset admission truth
- **02-04:** `public-docs-web` 的实现基线固定收口到现有仓库前端主栈：
  - `React`
  - `Vite`
  - `@cloudflare/vite-plugin`
  docs shell 可以借鉴 Starlight / Docusaurus 的 IA 与交互模式，但这些 donor 不能成为 canonical content、visibility 或 version truth owner。
- **02-05:** public current docs 可以走 `public_static_asset`；restricted/historical docs 即使 payload format 相同，也不得自动进入匿名 bundle。
- **02-05A:** `gated_asset` 的默认 delivery posture 固定为 same-site controlled proxy，而不是 direct presigned URL：
  - browser 只请求 `public-docs-web` same-site gated path
  - `public-docs-web` 先向 `app-api` 做逐请求实时 authz 校验
  - 校验通过后再受控读取对象存储 bytes
- **02-05B:** direct presigned URL 只保留为 future optimization / explicit exception，不作为 first-launch 默认受限交付方案。
- **02-05C:** short-lived grant token / local verification 只保留为 future optimization；`v1` 不先引入 token 验签分支。
- **02-06:** docs search 结果必须直接返回 canonical reader jump target：
  - `canonicalUrl`
  - `anchor`
  - `highlightRootUnitIds`
  不得返回 raw chunk locator 或 operator compact source trace。
- **02-07:** `Phase 2` 默认先覆盖当前两条默认公开 query-enabled collection：
  - `regulations/student_handbook`
  - `curriculum/curriculum_plan`
  但实现必须保留 corpus/collection 级扩展能力，不写死到单 collection。
- **02-08:** deploy sync manifest 必须由 app-owned truth 产生；前端 deploy 不允许直接扫描对象存储自行猜测应发布哪些文档版本。
- **02-09:** same-site `/api/docs/*` 必须服务 `public-docs-web`；即使后续 reader route 继续采用 Worker-hosted React shell，也仍由 `public-docs-web` 暴露 same-site seam，而不是让 browser 直打 `app-api` public hostname。

</decisions>

<specifics>
## Specific Gaps

- 当前 data plane 没有 reader projection builder，因此还不能把 canonical artifacts 物化成 `reader.json` / `outline.json` / `meta.json` / `asset-manifest.json`。
- 当前 `app-api` 还没有 docs domain module、routes 或 read model，`/api/docs/*` 仍只是文档 contract。
- 当前 repo 只有 object key builder，没有 public publish manifest、bundle admission 规则或静态同步输入。
- 当前 public chat 只有 `place_card` 这类 structured part，没有 canonical source-card payload。
- 当前 docs site 还不存在，因此如果不先完成 `Phase 2`，`Phase 3` 的 donor shell 会缺乏真实后端 seam，只能伪造 demo data。

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md`
- `.planning/workstreams/document-site-and-canonical-reader/ROADMAP.md`
- `.planning/workstreams/document-site-and-canonical-reader/STATE.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md`
- `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/SUMMARY.md`
- `.planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md`
- `docs/architecture/document-site-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/document-reader-publish-contract.md`
- `docs/data/canonical-document-reader-model.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/official-web-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `packages/ingestion-core/src/campus_ingestion_core/object_store.py`

### Web Sanity-Check References

- `https://developers.cloudflare.com/workers/static-assets/`
- `https://developers.cloudflare.com/workers/static-assets/binding/`
- `https://developers.cloudflare.com/workers/frameworks/framework-guides/astro/`
- `https://docs.astro.build/en/guides/content-collections/`
- `https://starlight.astro.build/guides/project-structure/`
- `https://starlight.astro.build/guides/site-search/`
- `https://docusaurus.io/docs/versioning`
- `https://gitbook.com/docs/publishing-documentation/gitbook-ai-assistant`
- `https://docs.readme.com/main/docs/ask-ai`
- `https://docs.readme.com/main/docs/versions`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 3`
  - `public-docs-web` shell / layout / landing / information architecture
- `Phase 4`
  - docs search UX
  - version navigation state
  - deep-link / highlight continuity
- `Phase 5`
  - public chat source-card UI 与 jump integration
- `Phase 6`
  - restricted/historical delivery acceptance
  - dev/staging smoke

</deferred>
