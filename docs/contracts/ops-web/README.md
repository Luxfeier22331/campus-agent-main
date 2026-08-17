---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Ops Web 接口

本目录定义 Ops Web 服务端提供给自身页面的 HTTP 接口：

- [runtime.md](./runtime.md)：运行概况、运行记录和按需系统记录；
- [providers.md](./providers.md)：在线模型配置；
- [internal-portal.md](./internal-portal.md)：内部门户凭据与自动化 token；
- [access.md](./access.md)：非校园邮箱准入；
- [users.md](./users.md)：用户、会话、账号操作记录和只读注销状态。

食堂和同好群分别由 [食堂产品文档](../../product/dining.md) 和
[同好群领域文档](../../domains/groups.md) 维护。可执行路由与 DTO 位于
`apps/ops-web/src/server/app.ts` 和 `apps/ops-web/src/shared/`。

## 共享规则

- `/api/ops/*` 接受经过 Cloudflare Access 验证的人员身份；Access policy 决定人员范围。
- `/api/automation/*` 只接受配置入口上的 Bearer token，不接受人员 JWT。
- 浏览器只调用同源接口，不获得数据库、供应商或内部服务凭据。
- 写操作继续执行同源、正文、并发和所属领域校验。
- 查询失败不能转换为空数组、无数据或成功状态。
- 响应不得包含数据库地址、JWT、Cookie、Secret、供应商原始响应或任意观测正文。
- 缓存、游标、状态枚举、错误码和精确字段由对应子合同及可执行 schema 维护。

错误使用统一 JSON envelope：

```json
{
  "error": {
    "code": "OPS_INVALID_QUERY",
    "message": "运行记录查询参数无效。"
  }
}
```

## 健康与就绪

`GET /healthz` 只证明 Node 进程可以响应，不访问依赖。

`GET /readyz` 无需操作者身份，只检查 Ops Web 接受核心请求所需的公开 origin、请求状态数据库，
以及非本地环境的 Access 配置。Axiom、Sentry、Langfuse、Temporal UI、在线模型配置、Dining 和
自动化机器入口不属于顶层就绪条件；它们在所属接口返回局部状态。

## 相关文档

- `../../product/ops-web.md`
- `../../architecture/system/ops-observability.md`
- `../../data/postgres-ownership.md`
