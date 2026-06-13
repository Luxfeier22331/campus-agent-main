---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-08
updated: 2026-06-12
---
# App API Dining HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 `campus-web` 的学生端 dining public contract。

它补充：

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-dining-ops-http.md`
- `docs/architecture/domains/dining/architecture.md`
- `docs/data/dining-operations-schema.md`

本文只描述学生端 published projection。Draft、release candidate、release command、
audit、source observation 与 operator 工作台字段属于
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
- published snapshot 缺少 sanitized SVG floorplan、SVG anchor binding、stall
  profile 或 menu item 时，route fail closed，不合成默认平面图、窗口、菜品名、价格或 tag。
- 响应不包含 draft、release candidate、audit event、operator principal、source
  observation、raw DB row、service secret、auth row、cookie 或 token。
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
          "floorId": "haidian-canteen-1-1f",
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
    "floorId": "haidian-canteen-1-1f",
    "label": "海淀一食堂一层",
    "floorplanAsset": {
      "anchorInventory": [
        {
          "anchorId": "window-01",
          "role": "window"
        }
      ],
      "bucket": "campus-rag-derived",
      "byteSize": 2048,
      "contentType": "image/svg+xml",
      "floorplanAssetId": "dining_floorplan_asset:...",
      "objectKey": "dining/releases/dining_release:.../floorplans/haidian-canteen-1/haidian-canteen-1-1f/sha256-....svg",
      "sha256": "sha256:..."
    },
    "svgAssetUrl": "/assets/dining/haidian-canteen-1-1f.svg",
    "svgMarkup": "<svg ...>...</svg>"
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
      "svgAnchorId": "window-01",
      "status": "active",
      "tags": ["主食", "热餐"],
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

- `floor.svgMarkup` 是 app-api 返回的 sanitized inline SVG；如响应只返回
  `svgAssetUrl`，该 asset 也必须是已 sanitize 的发布资产。
- `floor.floorplanAsset` 是发布快照冻结的 SVG object metadata；`objectKey`
  必须指向 release-owned key，不是 browser 直接下载 URL。
- `windows[].svgAnchorId` 对应 SVG 中的 `data-dining-anchor-id`。
- `svgAnchorId` 是 dining floorplan selection anchor，不是 campus navigation
  route graph。
- `windows[].assignment` 可为 `null`，表示该物理窗口当前没有 published 档口分配。
- `offerings[]` 挂在 assignment 下，不挂在 physical window 下。
- `saleStatus` 允许 `available`、`paused`、`seasonal`；`removed` 不返回。
- `filters.tags` 来自当前 published floor projection，不由前端硬编码。

## UI Consumption Rules

`campus-web` 可以：

- 按校区、食堂、楼层、tag 和搜索词筛选已返回 projection。
- inline 渲染 sanitized SVG，并用 `svgAnchorId` 高亮/跳转到对应 SVG 区块。
- 展示 `paused` 和 `seasonal` 状态。

`campus-web` 不可以：

- 读取 `/api/ops/dining/*`。
- 在 contract 缺字段时合成窗口坐标、菜品、价格、标签或平面图。
- 把 dining SVG anchor 当作 campus navigation spatial truth。
- 展示 draft、operator、audit 或 source observation 字段。
