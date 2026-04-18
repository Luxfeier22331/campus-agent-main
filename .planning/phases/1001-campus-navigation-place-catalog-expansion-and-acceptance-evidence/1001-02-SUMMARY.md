# 1001-02 Summary: nullable geometry admission、first-batch seed expansion 与 navigation regression refresh

## Outcome

`1001-02` 已完成。repo 现在不再把“没有受控精确坐标”的官方地点卡在 seed 外，而是把 `place_catalog` 收口为两种受控 geometry posture：

- 有受控 point geometry 的 row
- `point_geometry = null`，但 canonical label、`campus_scope`、coarse `location_description`、`source_refs` 和 `verification_state` 完整的 row

这一步同时把第一批 official-map-backed 点位正式写进 seed，并刷新了 navigation specialist 的 ambiguity / nullable-geometry regression。

## Key Changes

- `packages/navigation-specialist/src/campus_navigation_specialist/catalog.py`
  - `CatalogEntry.point_geometry` 改为可空
  - seed parser 现在接受 `point_geometry = null`
  - clarification hint 现在使用中文校区标签，而不是原始 `haidian/fengtai`
- `packages/navigation-specialist/src/campus_navigation_specialist/service.py`
  - clarification follow-up 文案现在会带 campus/hint，而不是重复输出同名 display name
- `configs/ingestion/campus_navigation/place_catalog/seed.v1.json`
  - first batch 从 `7` 条扩到 `12` 条
  - 新增：
    - 丰台校区北门
    - 丰台图书馆
    - 海淀校医院
    - 丰台校医院
    - 民族博物馆（海淀）
- `tests/specialist/test_navigation_specialist.py`
  - `图书馆在哪里` 现在固定为 clarification-first
  - `海淀图书馆在哪里` 保持 direct completion
  - `民族博物馆在哪里` 固化 nullable-geometry completion
- `tests/contracts/test_models.py`
  - 新增 `PlaceCard` 无 point geometry 的序列化回归
- `apps/app-api/test/chat-command.service.test.ts`
  - 新增 app-api 持久化无 point geometry place-card 的回归
- `docs/reference/campus-navigation-authoritative-source-inventory.md`
  - authoritative source inventory 现已升级为 first-batch admission truth
- `docs/data/campus-navigation-place-catalog.md`
  - place-catalog data truth 现已接受 nullable geometry posture

## Verification

Python:

```bash
uv run --all-packages python -m unittest \
  tests.specialist.test_navigation_specialist \
  tests.contracts.test_models \
  tests.supervisor.test_supervisor_routing \
  tests.supervisor.test_supervisor_validation
```

Result:

- `Ran 50 tests`
- `OK`

App API:

```bash
pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/chat-structured-parts.test.ts
```

Result:

- `Test Files 2 passed`
- `Tests 20 passed`

## External rationale

- RFC 7946 / GeoJSON 允许 `Feature.geometry = null`
- Geocoding 官方实践显式区分 `ROOFTOP` 与 `APPROXIMATE`

参考：

- `https://datatracker.ietf.org/doc/rfc7946/`
- `https://developers.google.com/maps/documentation/geocoding/requests-geocoding`

因此当前 repo 选择“不伪造精确坐标，而是显式承认 geometry 暂缺”符合更稳妥的长期边界。

## Remaining Gap

- `1001-02` 只完成了 first-batch seed admission，不代表官方地图上的所有 candidate 都已 admitted
- `综合楼`、`大礼堂`、`学生活动中心`、`逸夫体育馆` 等仍留在后续 candidate batch
- 真实 staging smoke / 人工验收证据不再作为当前执行项；地图实际上线前，校内导航产品路径已主动 fail-close

## Next

- 等待地图实际上线后，从 backlog `999.2` 恢复 `place_card` / map consumption 与 `1001-03` 验收工作
