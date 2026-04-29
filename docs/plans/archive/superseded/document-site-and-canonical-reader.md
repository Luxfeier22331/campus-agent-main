---
doc_type: plan
status: superseded
created: 2026-04-21
updated: 2026-04-22
---

# Document Site And Canonical Reader

## Goal

把文档站从讨论推进到 repo-tracked planning truth：
冻结 `public-docs-web`、published reader assets、`app-api` docs control-plane contract、
canonical reader model、reader asset publish contract、chat source-card jump contract 与后续 restricted/versioned reader rollout 的前向顺序。

## This Document Covers

- 文档站作为独立 browser surface 的产品边界
- `public-docs-web static reader assets + same-site /api/docs/* -> app-api` 的长期主链路
- docs search、reader route、version switcher、reader asset resolve、citation jump 的 contract
- object storage key layout、deploy sync manifest 与 static bundle sync contract
- canonical `anchor` / `rootUnitId` 作为用户态定位单位
- chat source card 与 docs reader 的衔接方式
- public / restricted reader 共用一套 reader truth 的规则

## This Document Does Not Cover

- donor shell 的具体视觉实现
- PDF 阅读器或原始附件消费
- source-truth / provider artifact 的用户可视化
- docs search 的底层算法、索引后端或 ranking 细节
- 当前 merged truth 是否已经存在 `public-docs-web`

## Bounded Problem Statement

当前 repo 已经具备：

- canonical document chain
- current-serving 与显式 historical query 的长期约束
- app-owned authz / visibility owner
- operator-safe compact source trace

但仍缺少一条正式前向设计来回答：

- 文档站是否应作为独立 browser surface
- chat 的来源展示是否应跳回 canonical reader
- docs search 和 chat 是否共用 reader target contract
- public / restricted document reader 是否应共用同一 model
- version / anchor / highlight 是否该在第一天进入 contract
- canonical doc 正文是否应作为 published static assets 交付

## Implementation Direction

1. 新增独立 `public-docs-web`，不把文档站并入 `public-chat-web`。
2. `public-docs-web` 继续部署为 Worker，但正文优先以 static reader assets 发布。
3. `app-api` 继续是 docs admission、version resolution、search、citation target 的 owner。
4. 新增 canonical reader projection，位置固定在 canonical document layer，而不是 chunk/index layer。
5. public published reader content 默认不由 API 逐次返回；API 只保留 control-plane seam。
6. 新增 reader asset descriptor / resolve contract，避免前端硬编码资产路径。
7. 新增 reader asset publish contract，明确 object storage key layout 与 deploy-time sync。
8. 用户态定位固定采用 `anchor + rootUnitId`，不暴露 `chunkId`。
9. docs search 与 chat source cards 共用 reader target contract。
10. restricted reader 不做第二套模型；只在 admission、delivery mode 与 visibility 上分化。
11. workstream 必须先完成 architecture / contract / data freeze，再进入 UI donor 和实现。

## Planned Phases

- `Phase 1`
  - `Document Site Architecture And Contract Freeze`
- `Phase 2`
  - `Published Reader Assets And App API Docs Control Plane`
- `Phase 3`
  - `Public Docs Web Shell And Information Architecture`
- `Phase 4`
  - `Docs Search, Version Navigation, And Static Reader State`
- `Phase 5`
  - `Chat Source Cards And Canonical Jump Integration`
- `Phase 6`
  - `Restricted / Historical Reader Handoff And Acceptance`

## Handoff Note

这条 workstream 当前先落 planning truth，不代表 `public-docs-web`、published reader assets 或 docs APIs 已经实现。
后续恢复时，应先从 `Phase 1` 的 architecture / contract freeze 继续，
而不是直接做 donor transplant 或临时 reader 页面。
