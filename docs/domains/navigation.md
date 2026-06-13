---
doc_type: index
truth_scope: capability
owner_boundary: domains/navigation
status: active
created: 2026-04-12
updated: 2026-04-20
---
# Navigation Domain

## 先看什么

- 架构总边界：`../architecture/domains/navigation/architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 长期方向：`../architecture/target-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/domains/navigation/architecture.md`
- `../decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `../decisions/adr-0027-navigation-and-spatial-truth.md`
- `../decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`

## Contract 与 Data

- `../contracts/navigation-place-finding-contract.md`
- `../data/campus-navigation-place-catalog.md`
- `../reference/campus-navigation-authoritative-source-inventory.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md`
- 当前项目执行状态与 backlog 恢复条件统一看 `README.md` 定义的通用执行态入口
- 需要恢复导航产品面时，先从 `../plans/campus-navigation-rollout-map-consumption.md` 进入；已完成
  foundation 只作为历史基线，不再充当当前入口

## 相关领域

- `identity-authz-memory.md`
  - current location 不是 verified identity / authorization truth，profile
    preference 也不能替代 route truth
