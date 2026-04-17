# Phase 1001: Campus Navigation Place Catalog Expansion And Acceptance Evidence - Research

**Researched:** 2026-04-13
**Domain:** campus place catalog source governance, alias ambiguity, and place-finding acceptance evidence
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Authoritative naming and campus scope

- canonical place name 与 `campus_scope` 以中央民族大学官方 `校园地图` / `校园导游` 页面为准。
- 官方地图只负责 authoritative label / campus presence，不直接充当精确 geometry 或 route truth。
- `source_refs` 需要同时保留 repo seed provenance 与官方页面 / 图片 URL。

#### Seed expansion posture

- 这轮只做第一批高频、位置稳定、官方图上明确可读的点位，不宣称全校 POI 已完成。
- 所有新增点位都必须显式记录 `verification_state`。
- 不允许从示意图布局反推“精确坐标”并把它伪装成 canonical geometry。

#### Ambiguity handling

- 相同 `display_name` 或 alias 跨校区出现时，默认 clarification-first。
- campus-qualified alias 继续允许直接命中。
- alias owner 继续在 `packages/navigation-specialist`，不下沉到 retrieval/backend 黑盒。

#### Acceptance evidence

- repo test 通过不等于 staging/UAT 已完成。
- 本 phase 必须定义 query inventory、smoke checklist 与 artifact expectation。

### Deferred Ideas (OUT OF SCOPE)

- `route_graph`
- `route_planning`
- entrance selection
- accessibility routing
- current-location-aware nearest ranking
- 底图 provider / SDK 选型
- open-domain off-campus POI search

</user_constraints>

## Summary

这条导航 follow-up 不是再做一轮 foundation 设计，而是把已经成立的 `place_lookup -> navigation-specialist -> place_card` 闭环，推进到可被真实用户问句消费的第一批 seed 和验收证据。联网核查表明，中央民族大学官方 `校园地图` 页面已经稳定提供海淀校区与丰台校区的校园地图图片，`校园导游` 页面又给出了同一组校区入口与公共服务语境，因此当前最合适的 authoritative source posture 是：

1. 用官方地图和公共服务页面冻结 canonical place label 与 `campus_scope`。
2. 把这些来源当作命名真相和 admission gate，而不是把示意图直接当 route truth 或精确 geometry truth。
3. 在 repo-owned `seed.v1.json` 中只接纳“高频、官方可读、可解释”的第一批点位；同名跨校区 family 明确走 clarification。

当前 repo 的代码形态已经天然支持这个方向。`resolve_place_candidates()` 先走 exact alias，再走 partial alias；只要 seed 中出现两个同名 canonical place，就会自然触发 clarification。也就是说，这个 phase 的关键不是再发明新的 disambiguation runtime，而是把 seed truth 与 regression baseline 改到真实世界形态。现有测试里把 `图书馆` 视为唯一海淀点位，这正是当前 seed 过小而非 runtime 设计正确的表现。

这轮 research 的最重要结论是：官方地图足够支撑“名称和校区归属”的第一批 admission，但不够支撑“精确点位坐标和路线关系”的强真相。因此 Phase 1001 应先做 authoritative source inventory、verification posture、ambiguity families、seed admission policy 和 acceptance evidence；不要为了追求立即扩面，反而把示意图位置硬写成看似精确的 geometry。geometry 只能来自可追溯的二次来源或人工校准，而这不改变 Phase 1001 先把 place catalog 扩面策略和验收合同落盘的优先级。

**Primary recommendation:** 以官方地图/校园导游为 naming truth，先冻结 first-batch candidate inventory 与 verification posture；随后在 seed admission 中优先接纳已有受控 geometry 的点位，并把同名跨校区 family 改成 clarification-first；最后以 query inventory + staging/manual artifact 的形式关闭 acceptance evidence。

## Standard Stack

| Component | Purpose | Repo Role |
|---|---|---|
| `https://www.muc.edu.cn/xxgk1/xydt.htm` | official campus label and campus-scope truth | primary authoritative source for place names |
| `https://www.muc.edu.cn/ggfw/xydy.htm` | secondary official campus/public-service context | corroborating source for campus segmentation and service-facing wording |
| `configs/ingestion/campus_navigation/place_catalog/seed.v1.json` | repo-owned canonical place seed | admission target |
| `packages/navigation-specialist` | alias normalization, ambiguity handling, answer shaping | execution owner |
| `tests/specialist/test_navigation_specialist.py` | deterministic regression baseline | ambiguity and direct-resolution gate |
| `docs/data/campus-navigation-place-catalog.md` | current data truth and runtime posture | doc truth that must stay aligned |

No new dependency is required for this phase. The work is primarily source governance, seed admission, regression coverage, and acceptance evidence.

## Architecture Patterns

### Pattern 1: Official Label Truth, Controlled Geometry Truth

**What:** Use official university pages to establish the canonical label, campus scope, and admission provenance. Treat geometry as a second controlled layer rather than inferring it from a schematic campus map.

**When to use:** Every new `place_catalog` row admitted via official map / campus-tour review.

**Repo-level recommendation:**

- Keep official page/image URL in `source_refs`.
- Keep `verification_state` explicit for every new row.
- Admit a place only when its geometry is controlled enough for the current `PlaceCard` contract.
- If geometry is not yet controlled, park the candidate in the phase inventory instead of fabricating coordinates.

### Pattern 2: Clarification-First Duplicate Families

**What:** Same-name places across campuses are not a bug in the seed; they are a real campus ambiguity that the runtime should surface.

**When to use:** `图书馆`、`北门`、`南门`、以及未来其他跨校区同名 building / gate / service-point family。

**Repo-level recommendation:**

- Add both canonical entities to the seed when officially confirmed.
- Preserve campus-qualified aliases for direct resolution.
- Update regressions so generic names expect `needs_clarification`, not `completed`.

### Pattern 3: Explicit Verification Posture Beats Silent Confidence

**What:** The seed should show what was reviewed and what still awaits field or geometry confirmation.

**When to use:** Every admitted seed row and every parked first-batch candidate.

**Repo-level recommendation:**

- Reuse the current explicit posture (`manual_seed_reviewed`, `manual_seed_pending_field_check`) unless and until a richer ladder is actually needed.
- Do not introduce implicit “probably correct” rows.
- Keep doc truth and runtime seed posture aligned.

### Pattern 4: Acceptance Evidence Is a First-Class Product Artifact

**What:** Place-finding should close with an explicit query inventory and staging/manual evidence, not with “tests passed therefore likely fine”.

**When to use:** Once the first-batch seed and ambiguity regressions are in place.

**Repo-level recommendation:**

- Define a representative inventory covering:
  - direct campus-qualified lookup
  - cross-campus ambiguous lookup
  - service-point lookup
  - unknown-place rejection
- Record artifact path, screenshots, and expected statuses (`completed` / `needs_clarification` / `no_answer`).

## Don't Hand-Roll

- Do not infer precise `point_geometry` from the visual position of an official schematic map image.
- Do not reopen `place_catalog` as a public retrieval surface just to reuse existing RAG plumbing.
- Do not patch ambiguity by hiding second candidates or privileging historical seed order.
- Do not treat staging/manual evidence as “nice to have later”; this phase exists partly to make it explicit.

## Common Pitfalls

- **Existing regression drift:** Once 丰台图书馆进入 seed, `图书馆在哪里` can no longer be asserted as a unique completed lookup.
- **Same-name gates across campuses:** `北门` / `南门` are expected clarification families, not exceptions.
- **Official map overreach:** The map is reliable for labels and campus placement, but not sufficient for route topology or exact spatial calibration.
- **Service-point dilution:** Do not add a large number of low-confidence service points just because they are adjacent to buildings on the map.

## Code-Level Notes

### Current runtime already supports the right ambiguity model

`packages/navigation-specialist/src/campus_navigation_specialist/catalog.py`

- `resolve_place_candidates()` first resolves exact normalized aliases.
- If multiple rows normalize to the same alias, the service layer returns clarification.
- Therefore the seed, not the runtime, is the main thing that must move from “accidental uniqueness” to “real campus ambiguity”.

### Current response contract is already sufficient

`packages/navigation-specialist/src/campus_navigation_specialist/service.py`

- `completed` already carries `resolved_place` and `place_card`.
- `needs_clarification` already carries candidate places.
- `no_answer` already exists for non-covered places.

This means Phase 1001 does not need a new contract family before seed expansion; it needs better seed truth and better regression coverage.

## External References

- 中央民族大学校园地图：`https://www.muc.edu.cn/xxgk1/xydt.htm`
- 中央民族大学校园导游：`https://www.muc.edu.cn/ggfw/xydy.htm`
- 海淀校区官方地图图片：`https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png`
- 丰台校区官方地图图片：`https://www.muc.edu.cn/__local/D/06/88/ED290FD6FCD89E0B4A6A5D0ADDA_11770E2B_26733.jpg`
