# ops-web

受保护的自托管运行状态与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Axiom、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录和依赖状态；
- 通过服务端固定查询访问 Axiom 和 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的在线模型配置、内部门户 TGC 替换、食堂和同好群内容运营操作；
- 通过 App API 管理邮箱准入、用户状态、会话和账号注销任务。

本应用不是产品 API、数据库浏览器、Temporal 控制台或通用 Secret 管理器。浏览器只调用同源
`/api/ops/*`，供应商凭据和数据库连接留在服务端。

## 页面

- `/overview`：运行概况；
- `/requests`、`/requests/:requestId`：运行记录与单次运行详情；
- `/providers`：在线问答当前模型配置；
- `/internal-portal`：固定 TGC 的更新时间、定期检查状态与替换入口；
- `/email-access`：非校园邮箱准入；
- `/users`、`/users/:userId`：用户查询、详情和固定账号操作；
- `/users/activity`：账号操作记录；
- `/account-deletions`：注销任务；
- `/dining`：食堂地图维护；
- `/groups`：同好群目录分组、群和展示顺序维护。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器合同位于 `src/shared/`，HTTP 实现位于
`src/server/app.ts`。

## 界面实现

- `@campus-agent/ui` 提供语义 Token、表单控件、状态显示和 Radix 复合控件；
- `src/app/ui/` 只保留 Ops 的 SidebarLayout 和 TanStack DataTable 等应用组合；
- 业务状态到中文文案和 tone 的穷尽映射留在 `src/app/`，共享包不猜测状态；
- 路由导航使用 TanStack Router，服务端数据使用 TanStack Query，表格与长日志分别使用 TanStack
  Table 和 Virtual；
- 本地和定时 browser lane 使用 Playwright 与 axe 验证代表性旅途，不新增 PR 浏览器门槛。

## 本地命令

```bash
pnpm dev:init
pnpm --dir apps/ops-web dev
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
pnpm --dir apps/ops-web db:check
pnpm --dir apps/ops-web db:generate
pnpm --dir apps/ops-web db:apply-dining
pnpm --dir apps/ops-web db:bootstrap-dining
```

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

内部门户页面只在 Kubernetes 部署中访问固定 Secret `source-collector-internal-portal-auth` 和固定
CronJob `source-collector-auth-check`。页面不返回当前 TGC，也不能选择其他 Secret、CronJob 或
namespace；该依赖不可用不影响 Ops Web readiness。

`pnpm dev:init` 为当前 worktree 创建独立 PostgreSQL database 和 derived bucket，并生成
`.env.local`。Ops Web 使用统一 `ops_web` 角色和 `object-store-secrets`；Dining 不创建专属
角色、连接、桶或凭据。

Dining 的声明式 schema 位于 `packages/domains/dining/src/schema.ts`，生成的 migration 位于
`apps/ops-web/drizzle/`，并使用 `drizzle.ops_web_dining_migrations`。结构变化先运行
`db:generate` 并审查新增 SQL；不得修改已应用 migration。`db:apply-dining` 按顺序执行 migration
和 Dining grants，`db:bootstrap-dining` 之后才写入首次草稿。授权和 bootstrap 不建表，也不维护
第二份 schema。

```bash
pnpm --dir apps/ops-web db:apply-dining
pnpm --dir apps/ops-web db:bootstrap-dining
```

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/product/ui.md`
- `docs/architecture/system/ui-foundation.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/ops-web/README.md`
- `docs/reference/telemetry.md`
- `docs/environment/providers.md`
