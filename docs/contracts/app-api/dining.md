---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 食堂公开接口

## 边界

本文定义 campus-web 使用的只读 `/api/dining/*`。app-api 不提供 Dining 写入、草稿、发布、回滚或
审核接口。领域与数据语义见 `../../architecture/domains/dining.md`。

所有接口经 campus-web same-origin `/api/*` 代理访问，错误使用 app-api 统一 error envelope。

## 接口

### `GET /api/dining/publication`

返回：

```json
{
  "catalogReleaseId": "dining_release:...",
  "reviewRevision": 12,
  "updatedAt": "2026-07-16T00:00:00.000Z"
}
```

用于低成本刷新检测，响应 `Cache-Control: public, max-age=0, must-revalidate`。Campus Web 在页面
可见时每 30 秒读取一次。

### `GET /api/dining/bootstrap`

返回全部已发布食堂摘要和首个食堂/地图的完整 floor projection：

```json
{
  "halls": [
    {
      "campus": "丰台校区",
      "hallId": "fengtai-juya-canteen",
      "name": "聚雅食堂",
      "floors": [{ "floorId": "...", "label": "一层" }],
      "tags": ["粉面", "热餐"]
    }
  ],
  "initial": { "floor": {} }
}
```

无 publication 时 `halls=[]` 且 `initial=null`。`initial` 必须匹配第一个 hall 的第一个 floor。

### `GET /api/dining/halls`

返回 `{ "halls": [...] }`，shape 与 bootstrap 的 hall summaries 相同。

### `GET /api/dining/halls/:hallId/floors/:floorId`

返回指定已发布地图的数据投影：稳定 floorplan identity、filters、physical windows、assignment、
stall 和 offerings。未分配窗口仍返回，`assignment=null`。不存在或不属于该食堂的 floor 返回 404。

```json
{
  "floor": {
    "floorId": "fengtai-juya-canteen-1f",
    "hallId": "fengtai-juya-canteen",
    "label": "一层",
    "floorplan": {
      "kind": "asset",
      "floorplanId": "floorplan:fengtai-juya-canteen:fengtai-juya-canteen-1f"
    }
  },
  "filters": { "tags": [] },
  "windows": [],
  "source": { "updatedAt": "2026-07-16T00:00:00.000Z" }
}
```

公开响应不得包含 `sha256`、`svgAssetUrl`、`canvas`、`anchorInventory`、`geometry` 或 SVG bytes。
Campus Web 根据自身构建中的 manifest 解析 `floorplanId`；API 字段不能覆盖本地静态资产 URL 或
checksum。地图引用未知时，Campus Web 只关闭地图区域，不把整个 floor 请求降级为失败。

公开 offering 只有：`offeringId`、自由菜品名称、可空 `priceLabel` 和 tags。接口不得增加份量、
sale status、availability、queue 或备注字段。

### `GET /api/dining/search?scopeHallId=...&q=...&tag=...`

在一个已发布食堂范围内搜索档口和菜品。`q` 与 `tag` 至少提供一个；`q` 最长 80 字符，`tag`
最长 40 字符。返回 result 的 hall、floor、window、stall 和可空 offering identity，不改变页面选择。

### `GET /api/dining/offerings/:offeringId/reviews`

返回：

```json
{
  "offeringId": "offering:...",
  "reviews": [
    {
      "reviewId": "review:...",
      "contributorName": "张同学",
      "rating": 4,
      "comment": "味道不错",
      "paidPriceLabel": "12 元",
      "images": [],
      "submittedAt": "2026-07-15T12:00:00.000Z"
    }
  ]
}
```

只返回 safe、published 且精确绑定当前 offering 的评价。响应不重复菜品名和档口名，因为页面上下文
已经提供这些信息。

## 缓存和一致性

除 publication 外，公开 Dining 响应使用短期 public cache。catalog release 变化后 Campus Web
刷新所有 Dining query 并清除本地窗口/菜品选择；review revision 单独变化时只刷新评价。

release payload 缺失、publication 与 payload release id 不一致、公开评价缺少精确 binding 或图片
结构非法时拒绝读取，返回 `dining_published_projection_invalid`，不得猜测或回退到开发
seed。地图 asset 的代码版本兼容性由 Campus Web 和 Ops rollback 校验，不由 app-api 注入资产元数据。
