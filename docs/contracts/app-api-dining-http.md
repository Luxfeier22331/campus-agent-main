---
doc_type: contract
status: active
created: 2026-06-08
updated: 2026-06-08
---
# App API Dining HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 `campus-web` 的学生端 dining public contract。

它补充：

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-dining-ops-http.md`
- `docs/architecture/domains/dining/architecture.md`
- `docs/data/dining-operations-schema.md`

本文只描述学生端 published projection。Draft、audit、release command、source
observation 与 operator 工作台字段属于
`docs/contracts/app-api-dining-ops-http.md`。

## Implemented Endpoints

```http
GET /api/dining/halls
GET /api/dining/halls/:hallId/floors/:floorId
```

## Source And Failure Boundary

学生端 dining routes 只读取 latest published dining release snapshot。

规则：

- 没有 published release 时，`GET /api/dining/halls` 返回 `{"halls":[]}`。
- 没有 published release 或 floor 不存在时，floor route 返回 typed `404`。
- published snapshot 缺少 floor canvas、SVG asset URL、stall profile 或 menu item
  时，route fail closed，不合成默认平面图、窗口、菜品名、价格或 tag。
- 响应不包含 draft、audit event、operator principal、source observation、raw DB
  row、service secret、auth row、cookie 或 token。
- `removed` offering 不出现在学生端响应中。

## Hall Summary

### `GET /api/dining/halls`

响应：

```json
{
  "halls": [
    {
      "hallId": "haidian-canteen-1",
      "campus": "海淀校区",
      "name": "海淀一食堂",
      "floors": [
        {
          "floorId": "1f",
          "label": "一层"
        }
      ],
      "stallCount": 5,
      "offeringCount": 8,
      "tags": ["主食", "热餐"],
      "priceRangeLabel": "6-18 元"
    }
  ]
}
```

字段规则：

- `stallCount` 统计当前 published snapshot 中该食堂的 active assignment 数。
- `offeringCount` 统计未 removed 的 published offering 数。
- `tags` 来自窗口、档口与菜品 tag 的去重汇总。
- `priceRangeLabel` 从 published offering 的 `priceLabel` 中提取展示用价格范围；
  没有可解析价格时为 `null`。
- `floors` 只暴露学生端楼层选择所需的 `floorId` 和 `label`。

## Floor Projection

### `GET /api/dining/halls/:hallId/floors/:floorId`

响应：

```json
{
  "floor": {
    "hallId": "haidian-canteen-1",
    "floorId": "1f",
    "label": "海淀一食堂一层",
    "svgAssetUrl": "/assets/dining/haidian-canteen-1-1f.svg",
    "canvas": {
      "width": 720,
      "height": 420
    }
  },
  "source": {
    "label": "校园食堂平面图整理",
    "updatedAt": "2026-06-08T00:00:00.000Z",
    "releaseId": "dining_release:initial"
  },
  "windows": [
    {
      "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01",
      "label": "盖饭窗口",
      "locationLabel": "入口左侧",
      "status": "active",
      "tags": ["主食", "热餐"],
      "geometry": {
        "x": 64,
        "y": 72,
        "width": 150,
        "height": 72
      },
      "assignment": {
        "assignmentId": "assignment:haidian-canteen-1:haidian-canteen-1-1f:haidian-canteen-1:haidian-canteen-1-1f:window-01",
        "stallProfile": {
          "stallProfileId": "stall:haidian-canteen-1:haidian-canteen-1-1f:rice-bowl",
          "displayName": "盖饭窗口",
          "stallType": "seeded_food_window",
          "tags": ["主食", "热餐"]
        },
        "offerings": [
          {
            "offeringId": "offering:assignment:...:menu:...",
            "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice-bowl:1",
            "name": "番茄牛腩饭",
            "tags": ["主食", "热餐"],
            "priceLabel": "18 元",
            "specLabel": "标准份",
            "saleStatus": "available"
          }
        ]
      }
    }
  ],
  "filters": {
    "tags": ["主食", "热餐"]
  }
}
```

字段规则：

- `floor.canvas` 是 SVG underlay 与 window geometry overlay 的坐标系。
- `floor.svgAssetUrl` 是学生端平面图 underlay asset。
- `windows[].geometry` 使用 `floor.canvas` 坐标系，不是 campus navigation route graph。
- `windows[].assignment` 可为 `null`，表示该物理窗口当前没有 published 档口分配。
- `offerings[]` 挂在 assignment 下，不挂在 physical window 下。
- `saleStatus` 允许 `available`、`paused`、`seasonal`；`removed` 不返回。
- `filters.tags` 来自当前 published floor projection，不由前端硬编码。

## UI Consumption Rules

`campus-web` 可以：

- 按校区、食堂、楼层、tag 和搜索词筛选已返回 projection。
- 用 `svgAssetUrl` 渲染平面图 underlay，用 `geometry` 渲染窗口 overlay。
- 展示 `paused` 和 `seasonal` 状态。

`campus-web` 不可以：

- 读取 `/api/ops/dining/*`。
- 在 contract 缺字段时合成窗口坐标、菜品、价格、标签或平面图。
- 把 dining window geometry 当作 campus navigation spatial truth。
- 展示 draft、operator、audit 或 source observation 字段。
