---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-14
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
- `../reference/campus-navigation-authoritative-source-inventory.md`

## 当前执行说明

- 长期架构已接受 `navigation-specialist`、`place_catalog` 与 chat-first / map-enhanced 交互边界
- 当前产品路径暂不支持校内导航；supervisor 已对 `place_lookup` fail-close，不把导航回答写成当前已开放能力
- `campus_services/*` 仍处于 `offline_preparation`；不要把 navigation route planning、full map surface 或 place-finding 写成已开放 merged truth
- `place_finding` foundation 当前只保留 repo-owned seed / contract / specialist truth；`place_card` / map consumption 与 staging/manual acceptance 已转入 backlog，等待地图实际上线后再恢复
- `route_graph` / `route_planning` 继续后置

## Completed Plan

- `../plans/campus-place-finding-foundation.md`

## 相关领域

- `identity-authz-memory.md`
  - current location 不是 verified identity / authorization truth，profile preference 也不能替代 route truth
