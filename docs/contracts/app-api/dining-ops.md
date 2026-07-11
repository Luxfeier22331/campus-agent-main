---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-08
updated: 2026-07-08
---
# App API Dining Ops HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 的 dining operations HTTP contract。

Dining operations 是 Operator Console 内的受控 operations domain。当前 route inventory
仍使用 `/api/ops/dining/*`，当前 implementation surface 是 `apps/operator-console-web`。

它补充：

- `docs/contracts/app-api/operator-ops.md`
- `docs/data/dining.md`
- `docs/architecture/domains/dining/architecture.md`

当前 contract 是 candidate-first release lifecycle。直接发布 current draft 的 route
不是目标 contract，也不在当前 route inventory 中。Source observation 的
apply/reject 语义只保留为 reserved boundary，不进入 accepted route inventory。

## Accepted Target Endpoints

```http
GET    /api/ops/dining/halls
GET    /api/ops/dining/halls/:hallId/floors/:floorId
PATCH  /api/ops/dining/windows/:windowId
POST   /api/ops/dining/window-assignments
PATCH  /api/ops/dining/window-assignments/:assignmentId
POST   /api/ops/dining/menu-items
PATCH  /api/ops/dining/menu-items/:menuItemId
POST   /api/ops/dining/menu-offerings
PATCH  /api/ops/dining/menu-offerings/:offeringId
GET    /api/ops/dining/release-candidates
POST   /api/ops/dining/release-candidates
GET    /api/ops/dining/release-candidates/:candidateId
POST   /api/ops/dining/release-candidates/:candidateId/validate
POST   /api/ops/dining/release-candidates/:candidateId/approve
POST   /api/ops/dining/release-candidates/:candidateId/schedule
POST   /api/ops/dining/release-candidates/:candidateId/publish
POST   /api/ops/dining/release-candidates/:candidateId/cancel
GET    /api/ops/dining/releases
GET    /api/ops/dining/releases/:releaseId
POST   /api/ops/dining/releases/:releaseId/rollback
GET    /api/ops/dining/audit-events
```

## Object Model

## Floorplan Reference

Dining floorplan owner、anchor、manifest lifecycle 和 technology choices 见
`docs/architecture/domains/dining/architecture.md`。本文只冻结 ops HTTP fields and
route behavior.

### Hall

```json
{
  "campus": "海淀校区",
  "floors": [
    {
      "floorId": "haidian-canteen-1-1f",
      "label": "一层",
      "floorplanId": "floorplan:haidian-canteen-1:1f",
      "svgAssetUrl": "/assets/dining/haidian-canteen-1-1f.svg"
    }
  ],
  "hallId": "haidian-canteen-1",
  "name": "海淀一食堂",
  "status": "active"
}
```

### Window

```json
{
  "floorId": "haidian-canteen-1-1f",
  "hallId": "haidian-canteen-1",
  "label": "热餐窗口",
  "locationLabel": "入口左侧",
  "svgAnchorId": "window-01",
  "status": "active",
  "tags": ["热餐"],
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

`svgAnchorId` binds the dining window to a sanitized SVG anchor. It is not
navigation route graph truth.

### Assignment

```json
{
  "assignmentId": "assignment:haidian-canteen-1:haidian-canteen-1-1f:haidian-canteen-1:haidian-canteen-1-1f:window-01",
  "stallProfileId": "stall:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "status": "active",
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

### Stall Profile

```json
{
  "displayName": "盖饭窗口",
  "stallProfileId": "stall:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "stallType": "food_window",
  "status": "active",
  "tags": ["主食"]
}
```

### Menu Item

```json
{
  "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "name": "盖饭",
  "status": "active",
  "tags": ["主食"]
}
```

### Menu Offering

```json
{
  "assignmentId": "assignment:haidian-canteen-1:haidian-canteen-1-1f:haidian-canteen-1:haidian-canteen-1-1f:window-01",
  "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice",
  "offeringId": "offering:assignment:...:menu:...",
  "priceLabel": "12-18 元"
}
```

## Read Routes

### `GET /api/ops/dining/halls`

返回：

```json
{
  "halls": []
}
```

### `GET /api/ops/dining/halls/:hallId/floors/:floorId`

返回 floor draft：

```json
{
  "assignments": [],
  "floor": {
    "floorId": "haidian-canteen-1-1f",
    "hallId": "haidian-canteen-1",
    "label": "海淀一食堂一层",
    "draftVersionId": "dining_draft_version:42",
        "floorplan": {
          "anchorInventory": [
            {
              "anchorId": "window-01",
              "label": "一号窗口",
              "role": "window"
            }
          ],
          "floorId": "haidian-canteen-1-1f",
          "floorplanId": "floorplan:haidian-canteen-1:haidian-canteen-1-1f",
          "hallId": "haidian-canteen-1",
          "sha256": "sha256:...",
          "svgAssetUrl": "/assets/dining/haidian-canteen-1-haidian-canteen-1-1f.svg"
        },
        "svgAssetUrl": "/assets/dining/haidian-canteen-1-haidian-canteen-1-1f.svg"
      },
  "menuItems": [],
  "menuOfferings": [],
  "stallProfiles": [],
  "windows": []
}
```

规则：

- 这是 draft read，不是 student published projection
- student-facing `/api/dining/*` 不能读取本 route
- ops response 只返回 repo floorplan manifest metadata，不返回 SVG markup、
  object storage bucket/key 或上传资产字段；Operator Console 通过
  `@campus-agent/dining/floorplans` package 渲染同一份 floorplan manifest
- floorplan changes are application releases, not ops HTTP commands

## Write Routes

### `PATCH /api/ops/dining/windows/:windowId`

请求：

```json
{
  "label": "南侧热餐窗口",
  "locationLabel": "南侧 01",
  "svgAnchorId": "window-01",
  "status": "maintenance",
  "tags": ["热餐", "维护中"]
}
```

返回：

```json
{
  "window": {}
}
```

### `POST /api/ops/dining/window-assignments`

请求：

```json
{
  "stallProfile": {
    "displayName": "新风味窗口",
    "stallType": "hot_meal",
    "tags": ["热餐"]
  },
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

返回 `201`：

```json
{
  "assignment": {},
  "stallProfile": {}
}
```

### `PATCH /api/ops/dining/window-assignments/:assignmentId`

请求：

```json
{
  "stallProfile": {
    "displayName": "南侧风味档口",
    "stallType": "hot_meal",
    "tags": ["热餐"]
  }
}
```

返回：

```json
{
  "assignment": {},
  "stallProfile": {}
}
```

### `POST /api/ops/dining/menu-items`

请求：

```json
{
  "name": "番茄牛腩饭",
  "tags": ["主食"]
}
```

返回 `201`：

```json
{
  "menuItem": {}
}
```

### `PATCH /api/ops/dining/menu-items/:menuItemId`

请求：

```json
{
  "name": "香菇鸡腿饭",
  "tags": ["主食", "热餐"]
}
```

返回：

```json
{
  "menuItem": {}
}
```

### `POST /api/ops/dining/menu-offerings`

请求：

```json
{
  "assignmentId": "assignment:...",
  "menuItemId": "menu:...",
  "priceLabel": "18 元"
}
```

返回 `201`：

```json
{
  "offering": {}
}
```

### `PATCH /api/ops/dining/menu-offerings/:offeringId`

请求：

```json
{
  "priceLabel": "16 元"
}
```

返回：

```json
{
  "offering": {}
}
```

## Release Candidate Routes

Release candidate routes are the accepted target publish lifecycle. They do not
publish mutable current draft directly.

### `GET /api/ops/dining/release-candidates`

返回：

```json
{
  "candidates": []
}
```

### `POST /api/ops/dining/release-candidates`

从当前 draft version 创建 candidate，并冻结 candidate snapshot refs。

请求：

```json
{
  "notes": "发布一食堂窗口菜品"
}
```

返回 `201`：

```json
{
  "candidate": {
    "baseDraftVersionId": "dining_draft_version:42",
    "candidateId": "dining_release_candidate:...",
    "createdAt": "2026-06-11T00:00:00.000Z",
    "createdBy": "operator_01",
    "notes": "发布一食堂窗口菜品",
    "publishMode": "manual",
    "scheduledAt": null,
    "snapshotHash": "sha256:...",
    "status": "candidate"
  },
  "validationReport": null
}
```

### `GET /api/ops/dining/release-candidates/:candidateId`

返回 candidate detail、validation report、frozen floorplan manifest refs、diff summary。

### `POST /api/ops/dining/release-candidates/:candidateId/validate`

重新生成 validation report。

返回：

```json
{
  "candidate": {
    "candidateId": "dining_release_candidate:...",
    "status": "validated"
  },
  "validationReport": {
    "blockers": [],
    "status": "pass",
    "warnings": []
  }
}
```

Blocker examples:

- `missing_floorplan_manifest`
- `floorplan_manifest_checksum_mismatch`
- `missing_svg_anchor`
- `duplicate_svg_anchor_binding`
- `unbound_required_window`
- `missing_stall_profile_projection`
- `missing_menu_item_projection`
- `stale_release_candidate`

### `POST /api/ops/dining/release-candidates/:candidateId/approve`

审批 blocker-free candidate。

请求：

```json
{
  "notes": "确认发布"
}
```

### `POST /api/ops/dining/release-candidates/:candidateId/schedule`

为 approved candidate 设置定时发布。

请求：

```json
{
  "scheduledAt": "2026-06-12T00:00:00.000Z"
}
```

规则：

- only approved candidates can be scheduled
- scheduler must revalidate before publish
- scheduler must never publish mutable current draft

### `POST /api/ops/dining/release-candidates/:candidateId/publish`

发布 approved candidate，写 immutable snapshot，更新 latest pointer，并写 audit event。

返回：

```json
{
  "release": {
    "candidateId": "dining_release_candidate:...",
    "publishedAt": "2026-06-11T00:00:00.000Z",
    "publishedBy": "operator_01",
    "releaseId": "dining_release:...",
    "snapshotHash": "sha256:...",
    "status": "published"
  },
  "snapshot": {}
}
```

规则：

- publish is all-or-nothing
- validation blockers fail closed
- stale candidate fails closed
- publish freezes the candidate floorplan manifest refs into the snapshot
- missing floorplan manifest entry fails closed
- floorplan manifest checksum mismatch fails closed
- failure must not update latest published pointer

### `POST /api/ops/dining/release-candidates/:candidateId/cancel`

取消尚未 published 的 candidate。Cancelled candidate 保留审计记录，不能再次发布。

## Published Release Routes

### `GET /api/ops/dining/releases`

返回：

```json
{
  "releases": []
}
```

### `GET /api/ops/dining/releases/:releaseId`

返回 published release metadata、immutable snapshot summary 和 floorplan manifest refs。

### `POST /api/ops/dining/releases/:releaseId/rollback`

回滚到历史 published release，或基于历史 snapshot 创建 rollback candidate。具体策略由实现选择，
但不得回写 mutable draft。

请求：

```json
{
  "mode": "latest_pointer",
  "notes": "回滚到上一版"
}
```

规则：

- rollback must write audit event
- rollback must not synthesize snapshot payload
- rollback must not read draft tables to rebuild historical projection
- rollback failure must leave latest pointer unchanged

## Source Observations Reserved Boundary

以下 route 不属于 accepted route inventory：

```http
GET  /api/ops/dining/source-observations
POST /api/ops/dining/source-observations/:observationId/apply
POST /api/ops/dining/source-observations/:observationId/reject
```

规则：

- source observation 只代表采集或人工观测，不代表线上事实
- apply/reject 不属于 accepted route inventory
- 如后续重新启用 apply/reject，必须先更新本 contract，再实现显式 operator command
