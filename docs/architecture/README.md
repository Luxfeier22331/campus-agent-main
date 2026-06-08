---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-23
---
# Architecture

`architecture/` 负责解释产品定位、当前 merged truth、长期目标与 supporting
architecture。它回答“系统是什么”“为什么这样分层”“哪些边界不能退回”。

## Repo Entry Truth

- `product-positioning.md`
  - 产品定位、目标用户与产品边界
- `current-architecture.md`
  - 当前 accepted merged-truth snapshot
- `target-architecture.md`
  - 长期目标架构与不可退回的硬约束

## Supporting Architecture Layout

- `system/README.md`
  - 跨域 supporting architecture；负责 runtime、execution、retrieval、data plane
    等 repo-wide supporting truth
- `domains/README.md`
  - 领域 supporting architecture；负责 navigation、official-web、authenticated
    notice、campus services 等领域边界

补充说明：

- `docs/architecture/domains/` 是 architecture-only 目录
- `docs/domains/` 是跨文档类型的领域 hub
- source-truth schema 已迁到 `docs/data/`，不继续留在 `architecture/`

## Source-Truth Schema

- `../data/official-web-source-truth-schema.md`
- `../data/authenticated-notice-source-truth-schema.md`
- `../data/dining-operations-schema.md`

## 使用规则

- `current-architecture.md` 只写 merged truth，不写 worktree-local 进度
- `target-architecture.md` 只写长期目标，不写当前 phase 顺序
- supporting architecture 负责解释某个边界，不承接一次性 plan 或执行历史
- 跨域 supporting architecture 放进 `system/`
- 领域 supporting architecture 放进 `domains/`
- canonical source-truth artifact/schema 放进 `docs/data/`，不伪装成 explanation-oriented
  architecture
