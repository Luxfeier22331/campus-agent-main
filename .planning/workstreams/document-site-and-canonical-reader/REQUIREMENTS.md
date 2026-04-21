---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-22
---

# Requirements: Document Site And Canonical Reader

## Goal

为 `campus-agent` 建立独立的 docs-first 文档站、published reader assets 与 canonical document reader lane，
冻结 browser surface、reader model、docs/search/citation control-plane seam，以及 public/restricted/historical reader 的长期边界。

## In Scope

- `public-docs-web` 作为独立 browser surface 的产品边界
- published static reader assets 的长期 delivery posture
- object storage key layout 与 deploy sync manifest contract
- `app-api` docs navigation / search / resolve / version seams
- canonical reader projection 的逻辑模型
- `anchor + rootUnitId` 作为用户态定位 contract
- docs search 与 chat source card 的统一 reader target
- public / restricted reader 的统一 admission model
- version-aware docs route 与 citation jump contract

## Non-goals

- PDF reader 或原始附件消费
- source-truth/provider artifact 用户态浏览
- docs search / retrieval backend 的底层算法优化
- 当前 merged truth 变更声明
- 把 docs site 并进 `public-chat-web`

## Success Criteria

1. repo 中存在独立 workstream，明确把文档站、reader model、source-card jump 与后续实现顺序收口到同一条线。
2. `public-docs-web` 被正式定义为独立 browser surface，而不是 `public-chat-web` 的页面模式。
3. public published reader content 被正式定义为静态 reader assets，而不是由 API 每次返回正文。
4. canonical reader model 明确以 `anchor` 和 `rootUnitId` 为用户态定位单位，不暴露 `chunkId`。
5. `app-api` docs HTTP seams 被正式写成独立 control-plane contract，覆盖 navigation、resolve、version list 与 docs search。
6. restricted / gated reader 的 delivery mode 被显式收口，不因静态化而绕过 authz。
7. published reader assets 的长期真相被正式固定在对象存储；deploy 只复制公开子集到 Worker static assets，不把 repo `assets/` 目录当真相。
8. chat 来源展示被正式定义为 source-card jump 到 canonical reader，而不是把 raw locator 写回正文。
9. public / restricted / historical reader 的前向路线被写清，后续实现不需要重新争论“是否做两套 reader”。

## Canonical Entry

- `.planning/workstreams/document-site-and-canonical-reader/README.md`
