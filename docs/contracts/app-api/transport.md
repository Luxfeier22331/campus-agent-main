---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 班车接口

## 边界

接口向 Campus Web 和其他公开消费者提供指定日期的结构化班车信息。接口只返回当前线路、乘车点、运行状态
和班次；可显式附带已发布关联通知的标题、发布日期和入口，不返回通知正文或管理页面数据。

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

两个接口均支持可选的 `include=notices`。未传时保持原响应字段；传入时，生效线路增加
`noticeContext: { validFrom, validTo, weekdays, notices }`。`notices` 每项为
`{ noticeId, title, releasedAt, isExternal, externalUrl }`，其中 ID 为十进制字符串；站内通知的
`externalUrl` 为 null，外部通知仅允许 HTTP(S) 链接。

只返回实际生效时间段关联且已发布的通知，按发布时间降序、通知 ID 降序排列；没有已发布关联时数组为空。
停运时间段也保留关联。时间段的起止日期和星期表达适用范围，不从通知发布日期推断生效日期。
范围查询先选出所有生效时间段，再批量查询一次关联和通知元数据，不按天或线路重复查询。
运营关联说明、通知正文、OCR 结果不进入该响应。通知正文仍由既有登录保护的通知接口提供。

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

请求包含通知时，额外只读 `transport.schedule_period_notices` 与 `notices.notices` 的公开元数据。

对每条线路，先筛选 `valid_from`、`valid_to` 和 ISO 星期均匹配请求日期的时间段，再按时间段的生效范围选择
一条完整班次表。班次明细上的 `boarding_point` 优先于时间段上的 `boarding_point_override`，后者优先于线路
默认乘车点；停运状态不输出班次明细。

`routeCatalog[].dropOffPoint` 使用当天生效时间段的 `drop_off_point_override`，未设置时沿用线路
`drop_off_point`。不新增逐班次下车点字段。

生效时间段按开始日期降序、结束日期升序（长期最后）、更新时间降序、标识升序选择；
Ops 月历和变更预览复用相同规则。

接口只提供当前结构化投影，不提供通知浏览、OCR、编辑操作或实时车辆位置。
