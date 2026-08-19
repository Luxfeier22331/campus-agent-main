# ops-web

受保护的自托管运行查看与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Axiom、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录和依赖状态；
- 通过服务端固定查询访问 Axiom 和 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的在线模型配置、食堂和同好群内容运营操作；
- 通过 ingestion-control 管理、检查和按需显示多条内部门户 TGC；
- 通过 execution-control 管理和验证在线模型当前设置；
- 通过 App API 管理邮箱准入、用户状态和会话，并在用户详情只读显示注销状态。

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

`/internal-portal` 还管理多条开发者自动化 token。人工管理接口继续使用 Cloudflare Access；开发者
程序使用环境配置的 `OPS_WEB_AUTOMATION_ORIGIN` 和 Bearer token，可以在名称不存在时创建一条具名
凭据，或读取 metadata、按 `If-Match` 更新 `ssoTgc`、删除凭据。Ops Web 只作为 UI/BFF，把这些操作
转发给 ingestion-control；TGC、检查结果和候选解析不存入 Ops Web 数据库。Source Collector 直接调用
ingestion-control 的内部解析接口。

## 内部边界

- Ops Status 的合同、环境组装、不可用实现和 PostgreSQL adapter 分离；路由只依赖 store 合同，不
  反向拥有数据库或外部平台配置；
- Node 服务内的 Ops Status、Dining 和自动化 token adapter 共享一个应用级 PostgreSQL Pool；
  内部门户凭据 adapter 调用 ingestion-control，不访问 Ops Web 数据库；Dining 地图、菜单和评价仍
  分别拥有具体 store，不互相导入具体实现；
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

`dev` 同时启动 Vite 和 Node API；`dev:ops-web-api` 只启动 Node API，适合让 MCP 或其他本地程序
直接调用。`dev:ops-web-api-fixture` 只监听 loopback，使用内存凭据服务和固定 fixture
token，启动时打印 endpoint、token 与测试凭据 ID；它不读取本地真实凭据，也不会改变生产代码或配置。
使用 MCP 验证 fixture 时，应让 MCP 与服务处于同一网络命名空间，再使用启动输出的 loopback endpoint。

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

`pnpm dev:init` 为当前 worktree 创建独立 PostgreSQL database 和 derived bucket，并生成
`.env.local`。Ops Web 使用统一 `ops_web` 角色和 `object-store-secrets`；Dining 不创建专属
角色、连接、桶或凭据。

Ops Web 的 Dining 与 automation token 声明式 schema 位于 `packages/domains/dining/src/schema.ts` 和
`apps/ops-web/ops/db/internal-portal-schema.ts`，生成的 migration 位于 `apps/ops-web/drizzle/`，并
共用历史命名的 `drizzle.ops_web_dining_migrations`。结构变化先运行
`db:generate` 并审查新增 SQL；不得修改已应用 migration。`db:apply-dining` 按顺序执行 migration
和 Dining grants，完整部署使用 `db:apply` 安装 Ops Web schema 和授权；`db:bootstrap-dining`
只在空库写入基线草稿，并通过正式 publisher 上传 SVG、原子写入 release 和当前 publication。
已有有效发布时该命令不修改数据；异常的部分初始化状态会明确失败。授权和 bootstrap 不建表，也不
维护第二份 schema。

```bash
pnpm --dir apps/ops-web db:apply-dining
pnpm --dir apps/ops-web db:bootstrap-dining
```

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/product/ui.md`
- `docs/contracts/ops-web/README.md`
- `docs/environment/providers.md`
