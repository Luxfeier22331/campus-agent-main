# Phase 1001: Campus Navigation Place Catalog Expansion And Acceptance Evidence - Context

**Gathered:** 2026-04-13
**Status:** Ready for research and planning
**Source:** Repo navigation truth + official MUC campus-map/public-service review

<domain>
## Phase Boundary

本 phase 只重开 Wave E foundation 之后明确留下的 3 类工作：

1. 把当前只有 `7` 条记录的 repo-owned `campus_navigation/place_catalog` 扩到“能支撑真实高频问句”的第一批 official-map-backed place seed。
2. 把跨校区同名地点的歧义行为从“碰巧唯一”收口为显式 clarification-first，例如 `图书馆`、`北门`、`南门` 这类 family。
3. 把 place-finding 的 staging smoke / 人工验收从口头 follow-up 变成明确的 query inventory、artifact path 和验收合同。

本 phase 明确不负责：

- `route_graph`
- `route_planning`
- entrance selection
- accessibility routing
- “离我最近”这类依赖当前位置或距离排序的问句
- 底图 provider / SDK / map renderer 选型
- 把 `place_catalog` 重新解释为公开 retrieval surface

</domain>

<decisions>
## Implementation Decisions

### Authoritative naming and campus scope

- canonical place name 与 `campus_scope` 以中央民族大学官方 `校园地图` / `校园导游` 页面为准。
- 官方地图可以作为“名称存在且属于哪个校区”的 authoritative source，但不能单独充当精确 geometry 或 route truth。
- `source_refs` 需要同时保留 repo seed provenance 与官方页面 / 图片 URL。

### Seed expansion posture

- 这轮只做“高频、位置稳定、官方图上明确可读”的第一批点位，不宣称全校 POI 已齐备。
- 所有新增点位都必须显式记录 `verification_state`；如果还没有 field verification，不能伪装成 fully verified。
- 不为了凑数量把示意图位置直接硬写成精确坐标；geometry 需要受控的二次来源或人工校准。

### Ambiguity handling

- 相同 `display_name` 或 alias 跨校区出现时，默认让 `navigation-specialist` 进入 clarification。
- campus-qualified alias 仍应允许直接命中，例如 `海淀图书馆`、`丰台图书馆`。
- alias owner 继续留在 `packages/navigation-specialist`，不把字符串魔改下沉到 retrieval/backend。

### Acceptance evidence

- repo test 通过只证明 code truth，不等于 staging/UAT 已完成。
- 本 phase 必须产出显式 query inventory、smoke checklist 与 artifact expectation，避免 place-finding evidence 再次漂成长期 todo。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning truth

- `.planning/PROJECT.md` — 当前 worktree truth、Wave E foundation 已完成、follow-up 应重开新 phase
- `.planning/STATE.md` — 当前 active lane / pending todo
- `.planning/ROADMAP.md` — Phase 1001 顺序与 phase record

### Architecture / decisions

- `docs/architecture/navigation-and-wayfinding-architecture.md` — 长期 navigation capability boundary
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md` — navigation-specialist / spatial truth owner
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md` — first ship 只做 place-finding，不做 route planning
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md` — alias governance owner 与 ambiguity posture

### Current data / contract / implementation

- `docs/contracts/navigation-place-finding-contract.md` — `place_lookup` / `place_card` contract
- `docs/data/campus-navigation-place-catalog.md` — current place-catalog data truth and runtime posture
- `configs/ingestion/campus_navigation/place_catalog/seed.v1.json` — current seed
- `configs/ingestion/campus_navigation/place_catalog/runtime-profile.json` — current specialist-private runtime posture
- `packages/navigation-specialist/src/campus_navigation_specialist/catalog.py` — alias normalization and candidate resolution
- `packages/navigation-specialist/src/campus_navigation_specialist/service.py` — clarification / no-answer / completed shaping
- `tests/specialist/test_navigation_specialist.py` — current regression baseline

</canonical_refs>

<specifics>
## Specific Facts To Preserve

### Current seed posture

- current seed count = `7`
- current seed only covers:
  - 图书馆（海淀）
  - 学生服务中心补卡机（海淀）
  - 教务处（海淀）
  - 海淀校区南门 / 北门
  - 丰台校区南门
  - 魏公村地铁站
- current tests still encode `图书馆` as a unique completed lookup; once 丰台图书馆进入 seed，这个假设必须改成 clarification-first

### Official source inventory

#### Primary official pages

- `https://www.muc.edu.cn/xxgk1/xydt.htm`
- `https://www.muc.edu.cn/ggfw/xydy.htm`

#### Official map images consumed in this research

- 海淀校区地图：`https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png`
- 丰台校区地图：`https://www.muc.edu.cn/__local/D/06/88/ED290FD6FCD89E0B4A6A5D0ADDA_11770E2B_26733.jpg`

### First-batch candidate inventory read from official maps

#### 海淀校区

- 海淀校区北门
- 海淀校区南门
- 西校门
- 东大门
- 东小门
- 图书馆
- 校医院
- 民族博物馆
- 逸夫体育馆
- 大礼堂
- 北综合楼
- 理工楼

#### 丰台校区

- 丰台校区北门
- 丰台校区南门
- 图书馆
- 综合楼
- 大礼堂
- 学生活动中心
- 校医院
- 综合体育馆
- 北体育场
- 南体育场
- 教师公寓
- 聚贤餐厅
- 馨雅餐厅

</specifics>

<deferred>
## Deferred Ideas

- 不在本 phase 内建设 `route_graph`
- 不在本 phase 内打开 full-map browse 或 route interaction
- 不在本 phase 内引入 off-campus open-domain POI search
- 不在本 phase 内把 provider geocode / map payload 升格为 canonical truth

</deferred>

---

*Phase: 1001-campus-navigation-place-catalog-expansion-and-acceptance-evidence*
*Context gathered: 2026-04-13 via repo truth + official MUC campus-map/public-service review*
