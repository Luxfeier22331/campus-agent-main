---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Navigation Domain

## 先看什么

- 架构总边界：`../architecture/navigation-and-wayfinding-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 长期方向：`../architecture/target-architecture.md`

## 长期边界与决策

- `../architecture/navigation-and-wayfinding-architecture.md`
- `../decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `../decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `../decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`

## Contract 与 Data

- `../contracts/navigation-place-finding-contract.md`
- `../data/campus-navigation-place-catalog.md`

## 当前执行说明

- 当前 merged truth 已接受 `navigation-specialist`、`place_catalog` 与 chat-first / map-enhanced 交互边界
- `campus_services/*` 仍处于 `offline_preparation`；不要把 navigation route planning 或 full map surface 写成已开放 merged truth
- `place_finding` foundation 已完成并退出默认 active 执行路径；后续 reopen 应在 `.planning/PROJECT.md` 中显式建新 phase

## Completed Plan

- `../plans/campus-place-finding-foundation.md`

## 相关领域

- `identity-authz-memory.md`
  - current location 不是 verified identity / authorization truth，profile preference 也不能替代 route truth
