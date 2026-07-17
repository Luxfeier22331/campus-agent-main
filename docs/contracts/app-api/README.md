---
doc_type: index
owner_boundary: apps/app-api
status: active
---

# App API HTTP 合同

本目录按接口领域维护 `app-api` HTTP 合同：

- [runtime.md](./runtime.md)：存活与就绪状态；
- [auth.md](./auth.md)：登录与当前用户；
- [memory.md](./memory.md)：个人记忆管理；
- [chat.md](./chat.md)：会话、请求、流和事件；
- [identity.md](./identity.md)：账号中心与身份产品投影；
- [federation.md](./federation.md)：联邦身份提供方；
- [dining.md](./dining.md)：学生侧食堂公开投影；
- [document-reader.md](./document-reader.md)：文档阅读器发布资产与读取模型；
- [eval-benchmark.md](./eval-benchmark.md)：评测基准入口；
- [error.md](./error.md)：共享错误结构；
- [request-lifecycle.md](./request-lifecycle.md)：请求、流和终态生命周期；
- [observability.md](./observability.md)：运维观测、质量、安全、成本和审计；
- [telemetry.md](./telemetry.md)：匿名前端性能指标写入；
- [operator.md](./operator.md)：采集任务运维投影；
- [operator-ops.md](./operator-ops.md)：运维接口横切合同；
- [transport-ops.md](./transport-ops.md)：班车来源确认、临时变更与发布；
- [地点领域](../../domains/place.md)：校园地图接口语义；
- [班车领域](../../domains/transport.md)：班车状态接口语义。

调用边界见 [product-runtime.md](../../architecture/system/product-runtime.md)；路由开放类别以
`apps/app-api/src/app/route-exposure-inventory.ts` 及其合同测试为准。
