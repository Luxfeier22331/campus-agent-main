---
doc_type: contract
owner_boundary: apps/app-api
status: active
---
# App API 前端性能观测合同

## 文档边界

本文冻结 Campus Web 匿名 Web Vitals 写入合同。它不定义用户行为分析、会话追踪、错误监控或
产品数据库 schema。

## 接口

```http
POST /api/telemetry/web-performance
Content-Type: application/json
```

请求：

```json
{
  "schemaVersion": "web_performance.v1",
  "metricName": "LCP",
  "value": 1250,
  "rating": "good",
  "navigationType": "navigate",
  "routeGroup": "dining"
}
```

成功响应为 `202`：

```json
{ "accepted": true }
```

## 字段约束

- `metricName` 只允许 `CLS`、`FCP`、`INP`、`LCP`、`TTFB`。
- `rating` 只允许 `good`、`needs-improvement`、`poor`。
- `navigationType` 只允许 `navigate`、`reload`、`back-forward`、
  `back-forward-cache`、`prerender`、`restore`。
- `routeGroup` 只允许 `qa`、`dining`、`map`、`services`、`feedback`、`account`、
  `docs`、`other`。
- `value` 必须是有限非负数；CLS 最大为 10，其他指标最大为 120000 ms。
- 请求必须只包含上述字段和 `schemaVersion`。未知字段返回 `validation_failed`，不能静默丢弃。

## 隐私与投递

- 浏览器不得发送 Web Vitals `id`、performance entries、raw pathname、query、hash、referrer、
  用户 id、账号、conversation id、内容或设备指纹。
- 浏览器使用 `credentials: omit`，该 endpoint 不读取 session，也不设置 cookie。
- App API 不把该数据写入 PostgreSQL；它只生成 sanitizer allowlist 内的
  `web.performance` telemetry event。
- OTLP 只输出固定 metric name、rating、navigation type、route group 与 release/environment
  metadata，不把数值或路径放入 attribute key。
- telemetry sink 失败不得改变 `202` 产品响应，也不得成为页面加载失败源。
