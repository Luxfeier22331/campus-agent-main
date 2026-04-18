# 1001-01 Summary: authoritative source inventory、admission posture 与 ambiguity family freeze

## Outcome

`1001-01` 已完成。repo 现在不再把 Phase 1001 的 place-catalog 扩面前提停留在口头上下文，而是把 authoritative source、candidate inventory、geometry admission posture 和 clarification-first family 全部落成 repo truth。

这一步完成了四件事：

- 新增中央民族大学导航 authoritative source inventory 文档，固定 official map / campus-tour page 的使用边界
- 冻结了第一批海淀 / 丰台 high-frequency place candidate inventory
- 明确了 `seed_ready` 与 `park_pending_geometry` 两种 admission posture
- 冻结了当前必须 clarification-first 的同名地点 family，避免后续 seed 仍沿“偶然唯一”前进

## Key Changes

- `docs/reference/campus-navigation-authoritative-source-inventory.md`
  - 新增官方来源清单、candidate inventory、admission posture、ambiguity family truth
- `docs/data/campus-navigation-place-catalog.md`
  - 新增 authoritative-source posture、geometry admission 约束与 ambiguity family 说明
- `configs/ingestion/campus_navigation/place_catalog/README.md`
  - 补 source-inventory 引用与 geometry 使用边界
- `docs/domains/navigation.md`
  - 把 source inventory 纳入导航域入口文档

## Verification

Doc review:

- `docs/contracts/navigation-place-finding-contract.md`
- `docs/data/campus-navigation-place-catalog.md`
- `configs/ingestion/campus_navigation/place_catalog/README.md`
- `tests/specialist/test_navigation_specialist.py`

Result:

- authoritative source inventory 已 repo-tracked
- admission posture 已明确
- clarification-first family 已显式列出

## Remaining Gap

- `1001-01` 只冻结了 source inventory / admission posture，并没有直接补 geometry
- 因此当前新增 candidate 仍停在 `park_pending_geometry`
- `1001-02` 需要先解决“受控 geometry 来源或人工校准方案”，然后才能把第一批 parked places 写入 seed 并刷新 specialist regression

## Next

- 执行 `1001-02`
