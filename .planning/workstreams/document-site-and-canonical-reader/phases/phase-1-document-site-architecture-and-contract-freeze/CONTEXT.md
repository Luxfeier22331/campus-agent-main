---
doc_type: context
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Context

## Why This Phase Exists

文档站已经被确认要作为独立长期产品面，但 repo 当前仍缺三类正式真相：

- `public-docs-web` 的 supporting architecture
- published static reader assets 的交付 posture
- `app-api` docs navigation / resolve / search seam
- canonical reader projection 的逻辑 model
- reader asset package 的 object storage key 与 deploy sync contract

如果跳过这一步直接做 donor transplant 或 reader 页面，后续很容易退化成：

- chat 和 docs 两套来源真相
- 用户 URL 绑死到 chunk 切分策略
- public / restricted 两套 reader contract
- docs site 自己解释 version / visibility
- API 每次回整篇正文，静态发布优势完全丢失

## Repo Facts

- 当前 accepted merged truth 仍只有：
  - `public-chat-web`
  - `protected-panel-web`
  - `app-api`
- repo data-plane chain 已固定为：
  - `source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`
- `document-units.jsonl` 已要求稳定提供：
  - `root_unit_id`
  - `anchor`
- `app-api` 当前已有 operator-safe compact source trace，但没有 browser-safe canonical source-card payload
- `public-chat-web` 当前 structured part 只有 `place_card`

## User Decisions Already Made

- 文档站只提供 canonical doc，不提供 PDF 消费
- 文档站采用独立 `public-docs-web`
- 文档正文优先走 static reader assets
- docs-first shell donor 方向成立
- `anchor + rootUnitId` 作为用户态定位 contract 成立
- docs search 应与 chat 分层

## Phase Output

本 phase 必须产出并冻结：

- `docs/architecture/document-site-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/document-reader-publish-contract.md`
- `docs/data/canonical-document-reader-model.md`
- active workstream entry 与 phase planning truth
