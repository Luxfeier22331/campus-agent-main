---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 班车接口

## 边界

接口向 Campus Web 和其他公开消费者提供指定日期的结构化班车信息。接口只返回当前线路、乘车点、运行状态
和班次，不返回数据库字段、通知内容或管理页面数据。

## 查询

`GET /api/transport/schedule?date=YYYY-MM-DD`

- `date` 必填，使用有效的 ISO 日期；按请求日期选择生效时间段；
- 接口无需登录；
- 成功响应使用 `Cache-Control: public, max-age=30, s-maxage=60`；错误响应使用 `no-store`；
- 日期格式无效返回 `400` 和 `transport_date_invalid`；结构化数据无效返回明确的投影错误，不转换为空结果。

## 响应

`GET /api/transport/schedule-range?from=YYYY-MM-DD&to=YYYY-MM-DD` 供月历查询；起止日期均包含在内，
最多 31 天。返回 `{ from, to, days }`，`days` 每项与单日接口相同，包含完整 `routeCatalog`。
日期范围无效返回 `400`；认证和缓存策略与单日接口一致。服务一次读取班次数据后生成整个范围，
不按天重复查询数据库。

```json
{
  "date": "2026-09-07",
  "routes": [
    {
      "routeId": "route:fengtai-to-haidian",
      "origin": "丰台校区",
      "destination": "海淀校区",
      "serviceKind": "commute",
      "boardingPoint": "聚雅餐厅东侧停车场路口",
      "status": "operating",
      "note": null,
      "departures": [
        {
          "kind": "fixed",
          "departureTime": "07:30",
          "boardingPoint": "聚雅餐厅东侧停车场路口",
          "riderType": "student",
          "capacity": null,
          "note": null
        }
      ]
    }
  ]
}
```

`serviceKind` 为 `commute`、`subway` 或 `special`。`status` 为 `operating` 或 `suspended`。固定班次返回
`departureTime`；间隔班次返回 `firstDepartureTime`、`lastDepartureTime` 和 `intervalMinutes`。`riderType`
为 `student`、`teacher` 或 `all`。

停运时间段仍返回线路，`status` 为 `suspended` 且 `departures` 为空。请求日期没有适用时间段的线路不返回。

## 投影规则

App API 读取：

- `transport.routes`；
- `transport.schedule_periods`；
- `transport.schedule_items`。

对每条线路，先筛选 `valid_from`、`valid_to` 和 ISO 星期均匹配请求日期的时间段，再按时间段的生效范围选择
一条完整班次表。班次明细上的 `boarding_point` 优先于时间段上的 `boarding_point_override`，后者优先于线路
默认乘车点；停运状态不输出班次明细。

生效时间段按开始日期降序、结束日期升序（长期最后）、更新时间降序、标识升序选择；
Ops 月历和变更预览复用相同规则。

接口只提供当前结构化投影，不提供通知浏览、OCR、编辑操作或实时车辆位置。
