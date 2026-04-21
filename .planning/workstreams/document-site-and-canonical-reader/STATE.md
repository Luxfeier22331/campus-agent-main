---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-04-22
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
**Last Activity:** 2026-04-21
**Last Activity Description:** Closed `Phase 1` architecture/contract/data freeze, added `Phase 1` summary, and created `Phase 2` planning artifacts to implement reader projection, published reader assets, deploy sync truth, and `app-api` docs control-plane seams.

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
  - 文档站采用独立 `public-docs-web` browser surface
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

## Blockers

- 当前 repo 仍没有 reader projection builder 或 published reader asset materialization path。
- 当前 `app-api` 仍没有 docs runtime module、route 和 read model。
- 当前 repo 还没有 deploy sync manifest 的代码真相，只冻结了 contract。
- 当前 `public-docs-web` app 还不存在，因此 `Phase 2` 必须先补真实 seam，不能直接跳到 donor shell。
- 当前 public chat 仍未消费 canonical source-card payload，但这属于 `Phase 5`，不阻塞本 phase。

## Verification

- planning/docs change only；本次新增 `Phase 1` summary 与 `Phase 2` planning artifacts，未实现新的 Worker app、reader API 或 UI
- `git diff --check -- docs/architecture/document-site-architecture.md docs/contracts/app-api-document-reader-http.md docs/contracts/document-reader-publish-contract.md docs/data/canonical-document-reader-model.md .planning/workstreams/document-site-and-canonical-reader/README.md .planning/workstreams/document-site-and-canonical-reader/ROADMAP.md .planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md .planning/workstreams/document-site-and-canonical-reader/STATE.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/SUMMARY.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/CONTEXT.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/RESEARCH.md .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`

## Session Continuity

**Stopped At:** `Phase 1` 已完成并进入 `Phase 2`；下一次恢复应直接 review `Phase 2` `PLAN.md`，然后决定是先做 reader projection 还是先做 `app-api` docs control-plane。
**Resume File:** .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md
