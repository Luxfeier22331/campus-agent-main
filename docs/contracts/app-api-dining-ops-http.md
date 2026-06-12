---
doc_type: contract
status: active
created: 2026-06-08
updated: 2026-06-12
---
# App API Dining Ops HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 的 dining operations HTTP contract。

它补充：

- `docs/contracts/app-api-campus-ops-http.md`
- `docs/data/dining-operations-schema.md`
- `docs/architecture/domains/dining/architecture.md`

当前 contract 是 candidate-first release lifecycle。直接发布 current draft 的 route
不是目标 contract，也不在当前 route inventory 中。Source observation 的
apply/reject 语义只保留为边界说明，不进入当前计划开发周期的 route inventory。

## Accepted Target Endpoints

```http
GET    /api/ops/dining/halls
GET    /api/ops/dining/halls/:hallId/floors/:floorId
POST   /api/ops/dining/floorplan-assets
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

## SVG Floorplan Technology

Dining floorplans are SVG assets with stable semantic anchors. `app-api` owns
upload-time SVG validation, allowlist sanitization and anchor extraction. The
frontend renders only sanitized inline SVG returned by `app-api` or published as
a trusted asset.

Selected libraries:

- `fast-xml-parser` for backend SVG validate/parse/build and anchor extraction
- dining-owned allowlist sanitizer for the backend security boundary
- optional `svgo` for optimization only, with `id` and `data-dining-*`
  attributes preserved
- `react-zoom-pan-pinch` for student and ops inline SVG viewport controls
- `@tanstack/react-table` for the ops SVG anchor inventory table
- `react-hook-form`, `@hookform/resolvers` and `zod` for the ops detail editor
  form state and validation

Not selected as the primary floorplan technology: `konva`, `react-konva`,
`fabric`, `d3`, MapLibre or indoor-navigation frameworks.

Allowed anchor shape:

```xml
<g data-dining-role="window" data-dining-anchor-id="window-01">
  ...
</g>
```

`data-dining-anchor-id` is the SVG visual anchor. `windowId` remains the dining
business object id. The binding lives in API data as `window.svgAnchorId`.

Release candidates and published snapshots freeze `objectKey`, `sha256`,
`anchorInventory` and `windowId <-> svgAnchorId` bindings. Publish promotes or
copies each frozen SVG object into a release-owned immutable key before snapshot
creation. Missing source objects fail closed and must not be synthesized during
publish.

### Hall

```json
{
  "campus": "海淀校区",
  "floors": [
    {
      "floorId": "haidian-canteen-1-1f",
      "label": "一层",
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
  "stallType": "seeded_food_window",
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
  "priceLabel": "12-18 元",
  "saleStatus": "available",
  "specLabel": null
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
    "floorplanAsset": {
      "anchorInventory": [
        {
          "anchorId": "window-01",
          "role": "window"
        }
      ],
      "bucket": "campus-rag-derived",
      "byteSize": 1024,
      "contentType": "image/svg+xml",
      "floorplanAssetId": "dining_floorplan_asset:...",
      "objectKey": "dining/floorplans/assets/haidian-canteen-1/haidian-canteen-1-1f/sha256-....svg",
      "sha256": "sha256:..."
    },
    "floorplanAssetId": "dining_floorplan_asset:...",
    "svgMarkup": "<svg ...>...</svg>",
    "svgAssetUrl": "/assets/dining/haidian-canteen-1-1f.svg"
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

## Floorplan Asset Routes

### `POST /api/ops/dining/floorplan-assets`

上传或替换某个 floor 的 SVG。`app-api` 必须 parse、sanitize、extract anchors，并返回
draft asset metadata。该 route 不发布学生端 projection。

请求：

```json
{
  "floorId": "haidian-canteen-1-1f",
  "sourceFilename": "haidian-canteen-1-1f.svg",
  "svgMarkup": "<svg ...>...</svg>"
}
```

返回 `201`：

```json
{
  "asset": {
    "anchorInventory": [
      {
        "anchorId": "window-01",
        "role": "window"
      },
      {
        "anchorId": "window-02",
        "role": "window"
      }
    ],
    "bucket": "campus-rag-derived",
    "byteSize": 2048,
    "contentType": "image/svg+xml",
    "floorId": "haidian-canteen-1-1f",
    "floorplanAssetId": "dining_floorplan_asset:...",
    "hallId": "haidian-canteen-1",
    "objectKey": "dining/floorplans/assets/haidian-canteen-1/haidian-canteen-1-1f/sha256-....svg",
    "sha256": "sha256:...",
    "status": "draft_ready"
  }
}
```

规则：

- raw SVG 不得进入 release snapshot
- sanitizer allowlist 是 backend security boundary
- returned `objectKey` is a sanitized draft asset key under
  `dining/floorplans/assets/{hallId}/{floorId}/sha256-{digest}.svg`
- anchor extraction only reads sanitized SVG
- object store must be configured; missing or partial object store config fails
  closed with `dining_floorplan_object_store_unavailable`

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
  "priceLabel": "18 元",
  "saleStatus": "available",
  "specLabel": "标准份"
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
  "priceLabel": "16 元",
  "saleStatus": "seasonal",
  "specLabel": "标准份"
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

返回 candidate detail、validation report、frozen floorplan refs、diff summary。

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

- `missing_floorplan_asset`
- `floorplan_asset_checksum_mismatch`
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
- publish copies candidate floorplan objects into
  `dining/releases/{releaseId}/floorplans/{hallId}/{floorId}/sha256-{digest}.svg`
- publish writes `dining/releases/{releaseId}/snapshot.json`
- publish writes `dining/releases/{releaseId}/validation-report.json`
- missing floorplan source object fails closed
- floorplan object checksum mismatch fails closed
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

返回 published release metadata、immutable snapshot summary 和 floorplan refs。

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

以下 route 不是当前 implemented endpoint，也不是当前计划开发周期承诺：

```http
GET  /api/ops/dining/source-observations
POST /api/ops/dining/source-observations/:observationId/apply
POST /api/ops/dining/source-observations/:observationId/reject
```

规则：

- source observation 只代表采集或人工观测，不代表线上事实
- apply/reject 必须写 audit event
- apply 只能显式写入 draft，不能直接发布
- reject 必须保留 reviewed metadata，不能删除 observation 证据
