# ops-web

受保护的自托管运行排查与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Axiom、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、请求诊断和依赖状态；
- 通过服务端固定查询访问 Axiom 和 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的 Provider Config、内部门户凭据和 Dining 内容运营操作。

本应用不是产品 API、数据库浏览器、Temporal 控制台或通用 Secret 管理器。浏览器只调用同源
`/api/ops/*`，供应商凭据和数据库连接留在服务端。

## 页面

- `/overview`：运行概况；
- `/requests`、`/requests/:requestId`：请求查找与排查；
- `/providers`：在线 Provider Config；
- `/internal-portal-auth`：固定门户认证；
- `/dining`：食堂内容运营。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器合同位于 `src/shared/`，HTTP 实现位于
`src/server/app.ts`。

## 入口

```bash
pnpm --dir apps/ops-web dev
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
```

核心运行投影的列级只读授权由模块安装器维护：

```bash
pnpm --dir apps/ops-web exec tsx ./ops/db/ops-web-database.ts apply
```

Dining schema、`ops_web_dining` 角色和权限由 Dining 发布单元维护。Ops Web 只可选消费对应连接，
Dining 未部署时不阻塞本应用的核心就绪状态。

## 相关文档

- `docs/product/ops-web.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/ops-web/README.md`
- `docs/reference/telemetry.md`
- `docs/environment/providers.md`
