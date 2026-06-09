---
doc_type: contract
status: active
created: 2026-06-08
updated: 2026-06-08
---
# App API Dining Ops HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 的 dining operations HTTP contract。

它补充：

- `docs/contracts/app-api-campus-ops-http.md`
- `docs/data/dining-operations-schema.md`
- `docs/architecture/domains/dining/architecture.md`

本文只把当前已实现 route 写入 implemented endpoint。Source observation 的 apply/reject
语义在本文冻结为 future contract，不进入当前 implemented route inventory。

## Implemented Endpoints

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
GET    /api/ops/dining/releases
POST   /api/ops/dining/releases
GET    /api/ops/dining/releases/:releaseId/preview
POST   /api/ops/dining/releases/:releaseId/publish
GET    /api/ops/dining/audit-events
```

## Object Model

### Hall

```json
{
  "campus": "海淀校区",
  "floors": [
    {
      "floorId": "1f",
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
  "floorId": "1f",
  "geometry": { "height": 72, "width": 150, "x": 64, "y": 72 },
  "hallId": "haidian-canteen-1",
  "label": "热餐窗口",
  "locationLabel": "入口左侧",
  "status": "active",
  "tags": ["热餐"],
  "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01"
}
```

`geometry` 是 indoor floorplan editor geometry，不是 navigation route graph。

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
    "floorId": "1f",
    "hallId": "haidian-canteen-1",
    "label": "海淀一食堂一层",
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

## Write Routes

### `PATCH /api/ops/dining/windows/:windowId`

请求：

```json
{
  "geometry": { "height": 72, "width": 150, "x": 64, "y": 72 },
  "label": "南侧热餐窗口",
  "locationLabel": "南侧 01",
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

## Release Routes

### `GET /api/ops/dining/releases`

返回：

```json
{
  "releases": []
}
```

### `POST /api/ops/dining/releases`

发布当前 draft，并返回 release 与 snapshot。

请求：

```json
{
  "notes": "发布一食堂窗口菜品"
}
```

### `GET /api/ops/dining/releases/:releaseId/preview`

返回当前 draft 的 preview snapshot 和 summary。当前实现不按历史 release id 回放旧 draft。

### `POST /api/ops/dining/releases/:releaseId/publish`

按当前 draft 生成新的 published snapshot。当前实现不允许 best-effort 部分发布。

## Source Observations Future Contract

以下 route 是 future contract，不是当前 implemented endpoint：

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
