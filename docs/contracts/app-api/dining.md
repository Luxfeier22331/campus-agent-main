---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-08
updated: 2026-07-02
---
# App API Dining HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 `campus-web` 的学生端 dining public contract。

它补充：

- `docs/contracts/app-api/README.md`
- `docs/contracts/app-api/dining-ops.md`
- `docs/architecture/domains/dining/architecture.md`
- `docs/data/dining.md`

本文只描述学生端 published projection。Draft、release candidate、release command、
audit、source observation 与 operator 工作台字段属于
`docs/contracts/app-api/dining-ops.md`。
Floorplan SVG owner、anchor 和 manifest lifecycle 见
`docs/architecture/domains/dining/architecture.md`。

## Implemented Endpoints

```http
GET /api/dining/halls
GET /api/dining/halls/:hallId/floors/:floorId
GET /api/dining/halls/:hallId/reviews
```

## Source And Failure Boundary

学生端 dining routes 只读取 latest published dining release snapshot。
`packages/dining-floorplans` 的 SVG、manifest 或 `packages/dining-domain` 的
scaffold 只说明 repo 有地图资产，不说明学生端已经可见；可见性必须以
`GET /api/dining/halls` 和对应 floor route 返回的 published projection 为准。

规则：

- 没有 published release 时，`GET /api/dining/halls` 返回 `{"halls":[]}`。
- 没有 published release 或 floor 不存在时，floor route 返回 typed `404`。
- published snapshot 缺少 floorplan manifest ref、SVG anchor binding、stall profile
  或 menu item 时，route fail closed，不合成默认平面图、窗口、菜品名、价格或 tag。
- 响应不包含 draft、release candidate、audit event、operator principal、source
  observation、raw DB row、service secret、auth row、cookie 或 token。
- 响应不包含菜品规格、售卖状态、采集统计、食堂价格区间或 release id。
  当前学生端以食堂地图为主体验，只消费食堂选择字段、档口地图锚点、
  菜品名与价格参考。
- 评价 route 当前读取 `dining.review_projections`，不在学生端请求链路中访问
  Lark / Feishu Base，也不暴露 Base file token。
- 表单中的菜品名称按原始提交展示，不做别名合并、纠错或 canonical menu item
  绑定。
- 当前评价投影必须先按 `校区 + 食堂 + 档口` 解析到已发布 catalog 的
  `hallId`、`stallProfileId` 与 `windowId`；不一致记录不得猜测映射到其他校区、食堂或档口。

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
      ]
    }
  ]
}
```

字段规则：

- hall summary 只用于学生端选择校区、食堂与地图。
- hall summary 不暴露采集覆盖度、档口数、菜品数、价格区间或 tag 汇总。
- `floors` 是历史字段名；学生端把它解释为可选地图列表。单地图食堂只返回
  一个 `{floorId, label}`，前端不展示楼层切换，也不把 `label` 当成学生端楼层信息。

## Floor Projection

### `GET /api/dining/halls/:hallId/floors/:floorId`

响应：

```json
{
  "floor": {
    "hallId": "haidian-canteen-1",
    "floorId": "haidian-canteen-1-1f",
    "label": "海淀一食堂",
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
  "source": {
    "updatedAt": "2026-06-08T00:00:00.000Z"
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
          "stallType": "food_window",
          "tags": ["主食", "热餐"]
        },
        "offerings": [
          {
            "offeringId": "offering:assignment:...:menu:...",
            "menuItemId": "menu:haidian-canteen-1:haidian-canteen-1-1f:rice-bowl:1",
            "name": "番茄牛腩饭",
            "tags": ["主食", "热餐"],
            "priceLabel": null
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

- `floor.floorplan` 是发布快照冻结的 floorplan manifest metadata；响应不暴露
  SVG markup、object storage bucket/key 或 operator-only asset 字段。
- `campus-web` 通过 repo 内 `dining-floorplans` package 用
  `hallId/floorId/floorplanId/sha256` 解析同一份 sanitized inline SVG；如果 HTTP
  metadata 与 repo manifest 不一致，前端必须 fail closed。`floorplanId` 以
  `placeholder:` 开头时表示当前还没有正式地图资产，前端应使用响应中的
  `windows[].geometry` 绘制占位地图。
- 学生端口径中 `windows[]` 表示地图上的档口。
- `windows[].svgAnchorId` 对应 SVG 中的 `data-dining-anchor-id`。
- `svgAnchorId` 是 dining floorplan selection anchor，不是 campus navigation
  route graph。
- `windows[].assignment` 可为 `null`，表示该地图档口当前没有 published 档口内容。
- `offerings[]` 挂在 assignment 下，不挂在 physical window 下。
- `offerings[].priceLabel` 是可为空的展示用价格参考，不是可计算价格或库存/售卖状态。
  缺失价格必须保留为 `null`；app-api 和 campus-web 都不得合成占位价格。
- `filters.tags` 来自当前 published floor projection，不由前端硬编码。

## Hall Reviews

### `GET /api/dining/halls/:hallId/reviews`

响应：

```json
{
  "reviews": [
    {
      "reviewId": "dining-review:rec27DpktN6uQn",
      "sourceRecordId": "rec27DpktN6uQn",
      "campus": "海淀校区",
      "hallId": "haidian-canteen-1",
      "hallName": "海淀一食堂",
      "stallProfileId": "stall:rec-stall-fish-noodle",
      "windowId": "haidian-canteen-1:haidian-canteen-1-1f:window-01",
      "stallName": "鱼粉",
      "dishName": "金汤鱼粉",
      "paidPriceLabel": "12 元",
      "rating": 4,
      "comment": "有一点辣，有一点酸。现煮的，需要等几分钟（不到五分钟吧）。分量比较大，能吃撑我。",
      "contributorName": "果小生",
      "images": []
    }
  ]
}
```

字段规则：

- `reviews[]` 是当前 hall 的只读评价投影，来源于 `jobs/dining-sync`
  已同步并审核通过的记录。
- `stallProfileId` 与 `windowId` 来自当前已发布 catalog，用于把评价放回地图档口。
- `stallName` 与 `dishName` 是表单自由文本；`dishName` 不做别名合并，也不表示
  已绑定到 canonical `menuItem` 或 `offering`。
- `campus-web` 只在当前地图选中的档口和菜品上下文下展示匹配评价；评价卡不重复展示
  `stallName` 或 `dishName`，评价图片通过本地静态资产 URL 预览。
- `paidPriceLabel` 是展示文本，不是可计算价格。
- `rating` 允许为 `null`。
- `images[].url` 必须是本地静态资产 URL；响应不得暴露 Lark / Feishu file
  token、附件下载 URL 或 operator-only source 字段。
- hall 不存在时返回 typed `404`。

## UI Consumption Rules

`campus-web` 可以：

- 按校区、食堂、地图、tag 和搜索词筛选已返回 projection。单地图食堂不展示地图
  / 楼层切换控件。
- 将地图作为主体验，点击或键盘选择 `svgAnchorId` 对应档口后展示菜品详情。
- 从 repo-versioned floorplan manifest 渲染地图，并用 `svgAnchorId`
  高亮/跳转到对应 SVG 区块。
- 当 `floor.floorplan.floorplanId` 以 `placeholder:` 开头时，显示“地图待补充”，并
  使用响应里的 `windows[].geometry` 绘制可点击档口。
- 在当前档口/菜品详情内展示匹配的只读评价和本地评价图片。
- 在评价读取失败时只在评价区域展示错误，不影响已加载的食堂地图和档口详情。

`campus-web` 不可以：

- 读取 `/api/ops/dining/*`。
- 在 contract 缺字段时合成窗口坐标、菜品、价格、标签或平面图。
- 展示食堂采集统计、食堂价格区间或 Base 备注。
- 把 dining SVG anchor 当作 campus navigation spatial truth。
- 展示 draft、operator、audit、source observation、release id、菜品规格或售卖状态字段。
- 把自由文本评价强行合并为 canonical 菜品，或把评价猜测绑定到
  `menuItemId`。
