# ops-web

受保护的自托管运行状态与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Axiom、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录和依赖状态；
- 通过服务端固定查询访问 Axiom 和 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的模型配置、内部门户凭据和 Dining 内容运营操作。

本应用不是产品 API、数据库浏览器、Temporal 控制台或通用 Secret 管理器。浏览器只调用同源
`/api/ops/*`，供应商凭据和数据库连接留在服务端。

## 页面

- `/overview`：运行概况；
- `/requests`、`/requests/:requestId`：运行记录与单次运行详情；
- `/providers`：在线问答与 Hindsight 当前模型配置；
- `/ingestion`、`/ingestion/tasks/:taskId`：采集运行与任务详情；
- `/internal-portal-auth`：固定门户认证；
- `/dining`：食堂内容运营。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器合同位于 `src/shared/`，HTTP 实现位于
`src/server/app.ts`。

## 界面实现

- `@campus-agent/ui` 提供语义 Token、表单控件、状态显示和 Radix 复合控件；
- `src/app/ui/` 只保留 Ops 的 SidebarLayout 和 TanStack DataTable 等应用组合；
- 业务状态到中文文案和 tone 的穷尽映射留在 `src/app/`，共享包不猜测状态；
- 路由导航使用 TanStack Router，服务端数据使用 TanStack Query，表格与长日志分别使用 TanStack
  Table 和 Virtual；
- 本地和定时 browser lane 使用 Playwright 与 axe 验证代表性旅途，不新增 PR 浏览器门槛。

## 入口

```bash
pnpm --dir apps/ops-web dev
pnpm --dir apps/ops-web dev:api
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
```

本地浏览器开发需要同时运行 `dev` 和 `dev:api`。前者提供 Vite 页面，后者以 fixture 数据提供同源
`/api/ops/*`；Vite 已将这些 API 请求代理到 `127.0.0.1:5178`。生产或真实集成验证使用 `start`，不使用
fixture API。

数据库 schema 和授权由模块自有安装器维护：

```bash
pnpm --dir apps/ops-web exec tsx ./ops/db/ops-web-database.ts apply
```

Dining schema、`ops_web_dining` 角色和权限由 Dining 发布单元维护。Ops Web 只可选消费对应连接，
Dining 未部署时不阻塞本应用的核心就绪状态。

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/ui.md`
- `docs/architecture/system/ui-foundation.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/ops-web/README.md`
- `docs/reference/telemetry.md`
- `docs/environment/providers.md`
