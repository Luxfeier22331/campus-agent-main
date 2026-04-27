---
doc_type: phase_plan
phase: "2"
phase_name: "Published Reader Assets And App API Docs Control Plane"
status: completed
created: 2026-04-21
updated: 2026-04-27
---

# Phase 2 Plan

## Objective

把 `document-site` 的第二层 runtime truth 收口成真实可消费状态：
让 canonical document artifacts 能稳定产出 published reader assets，
让 `app-api` 正式拥有 runtime-backed docs navigation / summary / version / resolve / search control-plane seams，
并把已经存在的 `public-docs` shell 从直接同步公开文档产物的过渡实现收口到长期 docs truth。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 冻结的 architecture / contract / data truth
- reader asset package / publish manifest builder
- `reader-assets/*` 的对象存储 contract
- canonical `anchor + rootUnitId` reader target model
- `app-api` docs route shell 与 browser contract types
- 正式 `public-docs` docs shell app

当前 repo 还没有：

- runtime-backed docs service 默认 wiring
- `public-docs` 对 published reader assets + same-site docs control-plane 的正式消费
- source-card compatible docs search results

如果不先做这一步，当前 `public-docs` 会继续停留在“shell 已存在，但长期 truth 仍未接入”的过渡状态，
这会把版本、visibility、resolve、search 和 publish truth 再次分裂成两套。

## Locked Inputs

- `public-docs` 是独立 browser surface；本 phase 只做 shell truth convergence，不做大幅 IA / 视觉重做
- public canonical doc 正文默认不通过 `/api/docs/*` 整篇返回
- published reader assets 的长期真相固定在对象存储
- `app-api` 是 docs control-plane owner
- `anchor + rootUnitId` 是用户态定位与高亮 contract
- public / restricted reader 共用同一 payload/model，但 delivery mode 必须分化
- 本 phase 的首发覆盖范围默认是：
  - `regulations/student_rules`
  - `curriculum/curriculum_plan`
- notice-derived/internal regulation 只能作为 conditional public subset 进入 `public-docs`：
  - 必须逐行显式 `visibility_level=public`
  - 不得携带 `entitlement_groups`
  - 当前 `regulations/institutional_rules` / `regulations/scoped_rules` 的 restricted 样本不得进入公开 docs
  - restricted reader / gated delivery 继续留到后续 restricted phase

## Decisions To Freeze

1. reader projection 的 canonical owner 固定为 data plane / `ingestion-core`，不是前端。
2. projection 输入允许消费：
   - canonical document artifacts
   - `document-units.jsonl`
   - registry metadata
   但不得消费 retrieval chunks。
3. `app-api` 是 docs navigation / summary / version / resolve / search 的唯一 browser-facing owner。
4. search 结果必须返回 canonical jump target，不返回 synthesis answer。
5. `resolve` 只返回 asset descriptor 与 reader state，不返回整篇正文。
6. deploy sync manifest 由 app-owned truth 产出，不由 deploy 脚本自行列桶猜测。
7. `public_static_asset` 与 `gated_asset` 必须在第一版就显式区分。

## Execution Slices

### Slice 1: Reader Projection And Asset Package Truth

- 复核并补齐 `packages/ingestion-core` 中的 reader projection / asset package truth。
- 输入：
  - canonical document metadata
  - `canonical.md`
  - `document-units.jsonl`
- 输出：
  - `reader.json`
  - `outline.json`
  - `meta.json`
  - `asset-manifest.json`
- 物化时继续复用已冻结的 `reader-assets/*` object key builder。
- 明确 section / block / anchor / rootUnitId 的序列化规则，确保后续 search/source-card 可以直接回链。

### Slice 2: Publish Admission And Sync Manifest Truth

- 在 `app-api` 补 runtime-backed docs publish read model/service，至少能回答：
  - 哪些 document version 属于 public current published subset
  - 哪些只能标记为 gated delivery
  - 对应的 asset package key 和 static bundle target path 是什么
- 产出 deploy sync manifest，作为 `public-docs` 后续构建输入。
- 禁止 deploy 直接扫描对象存储猜 public 子集。
- 当前过渡同步脚本也必须 fail-close：扫描到 notice-derived/internal regulation 时，只同步显式 public 且无 entitlement 的文档；restricted 文档必须跳过。

### Slice 3: App API Docs HTTP Control Plane

- 在 `apps/app-api` 保持既有 routes/contract 不变，补齐默认 runtime-backed docs service：
  - `GET /api/docs/collections/:corpus/:collection/navigation`
  - `GET /api/docs/collections/:corpus/:collection/search`
  - `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug`
  - `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/versions`
  - `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve`
- `resolve` 返回：
  - resolved version
  - `deliveryMode`
  - static asset URL 或 gated descriptor
  - initial `anchor` / `highlightRootUnitIds`
- `search` 返回 source-card compatible result item。

### Slice 4: Public Docs Shell Consumption Convergence

- 把 `public-docs` 从直接同步公开文档产物的过渡实现，收口到长期 docs truth：
  - published reader assets
  - same-site `/api/docs/*`
  - canonical resolve/navigation/version/search seam
- 保持当前 shell 可构建、可读、可 smoke，但不在本 phase 扩出新的 donor UI 重做。

### Slice 5: Search Target Shaping

- 基于 canonical reader model 输出 section hit：
  - `title`
  - `documentTitle`
  - `canonicalUrl`
  - `anchor`
  - `highlightRootUnitIds`
  - `snippet`
- snippet 只能来自 canonical reader units / blocks，不得把 raw chunk payload 直出到 browser contract。
- current phase 只做 current public docs search，不扩到底层 ranking 调优。

### Slice 6: Focused Tests And Smoke Harness

- `ingestion-core`
  - reader projection unit tests
  - asset package manifest tests
- `app-api`
  - docs route tests
  - resolve/search contract tests
  - visibility / delivery-mode tests
- 如需要最小 smoke harness：
  - 为 `student_rules` 与 `curriculum_plan` 增加 sample publish fixtures
- 明确 fail-close 断言：
  - restricted version 不得伪装成 public static path
  - response 不得泄漏 `chunkId`、object key、raw source locator

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/` 下新增 reader projection / publish module
- `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- `apps/app-api/src/` 下新增 docs domain service / routes / types
- `apps/app-api/test/` 下新增 docs route/service tests
- `apps/public-docs/` 下收口当前 docs shell 的真实消费方式
- `tests/ingestion/` 下新增 reader projection tests
- 如需要 shared type reuse，再评估是否补 repo-local typed schema，但不先把 browser HTTP shape提升到 `packages/contracts`

## Verification Matrix

- projection verification
  - sample canonical doc 能产出四个 reader asset 文件
  - block / outline / metadata 与 canonical reader model 一致
- publish verification
  - object key 落在既定 `reader-assets/*` prefix
  - public vs gated delivery mode 可机器校验
  - deploy sync manifest 不依赖对象存储盲扫
- app-api verification
  - docs routes 返回 shape 与 contract 一致
  - `resolve` 不返回正文
  - `search` 只返回 canonical jump target
- safety verification
  - browser contract 不泄漏 `chunkId`
  - browser contract 不泄漏 raw source/object-store locator
  - restricted delivery 不会退化成 public static path
- boundary verification
  - 本 phase 不重开第二个 docs app
  - 本 phase 不实现 chat source-card UI

## Exit Rule

Phase 2 完成后，repo 应达到：

- canonical docs 已能生成 published reader assets
- `app-api` 已拥有 docs control-plane runtime seams
- public current docs 的 publish subset 已有明确 deploy sync truth
- `public-docs` 可以直接消费真实 `/api/docs/*` 与 `/_docs/...`，而不再依赖直接同步公开文档产物的过渡实现
