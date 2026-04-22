---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 2
**Current Phase Name:** Published Reader Assets And App API Docs Control Plane
**Current Plan:** `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`
**Total Phases:** 6
**Total Plans in Phase:** 1
**Progress:** 1/6 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Promoted `apps/public-docs` to the formal docs app name, removed legacy docs app names from active runtime/config truth, and started rewriting the live planning truth so the workstream no longer claims the docs app is missing.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/SUMMARY.md`

- current `Phase 2` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`

- 当前已冻结的决策：
  - 文档站采用独立 `public-docs` browser surface
  - 文档站只消费清洗与归一化后的 canonical doc，不提供 PDF 消费
  - public published reader content 优先走 static reader assets，而不是 API 返回整篇正文
  - published reader assets 的长期真相固定在对象存储；Worker static assets 只是 deploy-time sync 复制品
  - chat 来源展示必须回链到 canonical reader，而不是暴露 raw chunk/source locator
  - public / restricted reader 长期共用同一 reader truth，差异只在 admission / visibility
  - donor posture 采用成熟 docs-first shell 方向，而不是 chat-first shell

- 当前需要 `Phase 2` 收口的 runtime truth：
  - canonical document artifacts 如何生成 `reader.json` / `outline.json` / `meta.json` / `asset-manifest.json`
  - app-owned deploy sync manifest 如何声明 public published subset
  - `app-api` docs navigation / summary / versions / resolve / search 如何正式落成
  - `public_static_asset` 与 `gated_asset` 如何在 resolve contract 中显式分化
  - docs search 如何输出 source-card-compatible canonical jump target
  - 哪些样本 collection/version 作为首轮 publish/smoke 子集
  - 当前 `public-docs` shell 如何从“直接同步公开文档产物”的过渡实现，收口到 published reader assets + same-site docs control-plane

- 当前 repo 已有的实现真相：
  - `apps/public-docs` 已是正式 docs shell app，当前采用 `Rspress`
  - `packages/ingestion-core/src/campus_ingestion_core/document_reader_assets.py` 已存在 reader asset package builder 与 `public_docs` sync manifest builder
  - `apps/app-api/src/app/routes/docs.ts` 已注册 docs route shell
  - `apps/app-api/src/modules/docs/index.ts` 已冻结 docs browser contract types

- 当前仍未闭环的实现真相：
  - `app-api` 默认 wiring 仍回落到 `buildUnavailableDocsService()`，docs routes 还不是 runtime-backed live service
  - `public-docs` 当前仍通过 `sync_real_docs.py` 直接同步公开文档产物，不是 published reader assets + same-site `/api/docs/*` consumption
  - `public-docs` 当前 shell 还没有把 navigation / resolve / version / search 全部切到 `app-api` docs control-plane
  - phase 文档此前仍把 docs app 写成“尚未存在”，这已不符合当前 repo 真相

## Blockers

- 当前 `app-api` docs route shell 还没有接上 runtime-backed docs service；默认配置下只会返回 `docs_not_configured`。
- 当前 `public-docs` shell 仍未消费 same-site `/api/docs/*` 与 published reader assets，因此当前文档站仍停留在过渡实现。
- 当前 phase planning truth 刚从“docs app 还不存在”的旧叙述迁移出来，仍需要与现有代码真相重新对齐。
- 当前 public chat 仍未消费 canonical source-card payload，但这属于 `Phase 5`，不阻塞本 phase。

## Verification

- planning/docs truth rewrite only；本次工作修正 active docs / planning truth，不宣称 runtime convergence 已完成
- 需要用专门回归测试覆盖：
  - active workstream 不再出现旧 docs app 名称
  - repo 当前真相入口已显式记录 `apps/public-docs`
  - `public-docs` 自身文案不再把本地对象存储路径与底层文件名冒充产品真相

## Session Continuity

**Stopped At:** `public-docs` 已提升为正式 docs app 名称，active planning truth 正在改写为与当前 repo 实现一致；下一次恢复应先确认 `Phase 2` 还缺哪些 runtime-backed docs service / shell consumption 收口项，再决定是否继续留在 `Phase 2` 或推进到 `Phase 3`。
**Resume File:** .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md
