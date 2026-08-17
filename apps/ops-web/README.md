# ops-web

受保护的自托管运行查看与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 读取 PostgreSQL 中的产品与执行投影；
- 按固定查询关联 Axiom application logs 和 Sentry Issues；
- 提供 Temporal、Langfuse 等外部平台的受控入口；
- 管理在线模型配置、内部门户凭据、账号、食堂和同好群；
- 为开发者自动化提供独立的具名凭据机器接口。

浏览器只调用同源 `/api/ops/*`。本应用不是产品 API、数据库浏览器、通用观测查询或 Kubernetes
控制台。

## 页面

- `/overview`：运行概况；
- `/requests`、`/requests/:requestId`：运行记录与详情；
- `/providers`：在线模型配置；
- `/internal-portal`：门户凭据与自动化 token；
- `/email-access`、`/users`、`/users/:userId`、`/users/activity`：账号管理；
- `/dining`：食堂内容维护；
- `/groups`：同好群目录维护。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器 DTO 位于 `src/shared/`，HTTP 入口位于
`src/server/app.ts`。

## 内部边界

- Ops Status 的合同、环境组装、不可用实现和 PostgreSQL adapter 分离；路由只依赖 store 合同，不
  反向拥有数据库或外部平台配置；
- Node 服务内的 Ops Status、Dining、内部门户凭据和自动化 token adapter 共享一个应用级
  PostgreSQL Pool；Dining 地图、菜单和评价仍分别拥有具体 store，不互相导入具体实现；
- 页面负责 query、mutation 和用户交互编排；可独立验证的目录变换、拖拽规则和编辑器视图不与页面
  网络状态耦合；
- 跨应用集成测试通过 HTTP、共享合同或明确的 `test-support` adapter，不直接导入另一应用的
  `src/`。

## 本地命令

```bash
pnpm dev:init
pnpm --dir apps/ops-web dev
pnpm dev:ops-web-api
pnpm dev:ops-web-api-fixture
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
pnpm --dir apps/ops-web db:check
pnpm --dir apps/ops-web db:generate
```

`dev` 同时启动页面和 Node API；fixture 入口只监听 loopback，使用隔离数据，不读取真实凭据。
数据库结构变化通过现有 Drizzle schema、migration 和所属数据库检查完成，不修改已应用 migration。

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/ops-web/README.md`
- `docs/environment/providers.md`
