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
- [federation.md](./federation.md)：联邦身份提供方；
- [notices.md](./notices.md)：通知目录、站内详情与图片；
- [食堂](../../product/dining.md)：学生侧地图、菜单、评价和举报接口；
- [error.md](./error.md)：共享错误结构；
- [request-lifecycle.md](./request-lifecycle.md)：请求、流和终态生命周期；
- 地图不属于 app-api HTTP 合同；地点目录和静态资产语义见[地点领域](../../domains/place.md)；

调用边界见 [product-runtime.md](../../architecture/system/product-runtime.md)；路由开放类别以
`apps/app-api/src/app/route-exposure-inventory.ts` 及其合同测试为准。

在线模型配置、内部门户凭据与采集解析、运维诊断不属于 app-api HTTP 合同，分别由
`execution-control` 和 `ops-web` 拥有。
