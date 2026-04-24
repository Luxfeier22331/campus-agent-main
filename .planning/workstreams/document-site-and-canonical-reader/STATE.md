---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-04-25
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
**Last Activity:** 2026-04-25
**Last Activity Description:** Closed the public-docs rendering repair slice for canonical student-handbook and curriculum pages: handbook lead-ins, dense handbook enumerations, inline handbook chapter markers, curriculum specialty graduation headings, weak subsection lead-ins, table captions, dense `(1)` / `1)` enumerations, stale MinerU table artifacts, wide-table scrolling, and course-map duplicate React keys are now covered by generator/normalization tests and live docs smoke.

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
  - notice-derived/internal regulation 如何进入 docs：public-only 子集可进公开 docs，restricted 子集必须等 restricted reader / gated delivery

- 当前 repo 已有的实现真相：
  - `apps/public-docs` 已是正式 docs shell app，当前采用 `Rspress`
  - `apps/public-docs` 生成器已覆盖一批 reader-facing rendering repairs：学生手册 lead-in label、密集 `(一)(二)(三)` 枚举分段、行内 `二、管理` 等章节点标题化、培养方案 `...专业毕业要求:` 标题化、弱结构标签 lead-in 化、`表 1 ...` caption 化、`(1)` / `1)` 密集枚举分段与宽表横向滚动
  - `apps/public-docs` 课程地图组件已使用 occurrence key 处理同名同学期节点和重复边，避免 live smoke 中出现 React duplicate-key 渲染告警
  - `packages/ingestion-core/src/campus_ingestion_core/document_reader_assets.py` 已存在 reader asset package builder 与 `public_docs` sync manifest builder
  - `apps/app-api/src/app/routes/docs.ts` 已注册 docs route shell
  - `apps/app-api/src/modules/docs/index.ts` 已冻结 docs browser contract types
  - `apps/public-docs/scripts/_sync_real_docs/regulations.py` 已新增 public-only regulation 同步入口；当前对象存储没有显式 public 的 notice-derived regulation，因此不会生成 `campus-regulations` 公开目录

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

- `pnpm --filter public-docs test`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_provider_normalize`
- static scans for dense `(1)` / `1)` enumerations, unstyled course-list lead-ins, stale global-competence slash, stale cross-discipline split, and unstyled weak curriculum subsection labels
- Playwright smoke on `http://127.0.0.1:5177` for home, student-handbook index, curriculum index, computer/economics/russian/electronics curriculum pages, mobile search/wide-table behavior, and course-map route/graph toggles

## Session Continuity

**Stopped At:** `public-docs` canonical rendering repair slice 已收口并通过本地 gate / live smoke；下一次恢复应回到 `Phase 2` 的 runtime-backed docs service、published reader assets、same-site `/api/docs/*` shell consumption 收口项，而不是继续扩展本轮生成器修复。
**Resume File:** .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md
