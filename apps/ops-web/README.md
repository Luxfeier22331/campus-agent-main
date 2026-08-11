# ops-web

受保护的自托管运行状态与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Axiom、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录和依赖状态；
- 通过服务端固定查询访问 Axiom 和 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的在线模型配置、食堂和同好群内容运营操作；
- 持久化、验证、定时检查并按需显示多条内部门户 TGC；
- 通过 App API 管理邮箱准入、用户状态和会话，并在用户详情只读显示注销状态。

本应用不是产品 API、数据库浏览器、Temporal 控制台或通用 Secret 管理器。浏览器只调用同源
`/api/ops/*`；只有操作者明确请求显示时，内部门户 TGC 才进入当前对话框，其他供应商凭据和
数据库连接留在服务端。

## 页面

- `/overview`：运行概况；
- `/requests`、`/requests/:requestId`：运行记录与单次运行详情；
- `/providers`：在线问答当前模型配置；
- `/internal-portal`：内部门户凭据录入、检查、轮换和明文读取；
- `/email-access`：非校园邮箱准入；
- `/users`、`/users/:userId`：用户查询、详情和固定账号操作；
- `/users/activity`：账号操作记录；
- `/dining`：食堂地图维护；
- `/groups`：同好群目录分组、群和展示顺序维护。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器合同位于 `src/shared/`，HTTP 实现位于
`src/server/app.ts`。

`/internal-portal` 还管理多条开发者自动化 token。人工管理接口继续使用 Cloudflare Access；开发者
程序使用环境配置的 `OPS_WEB_AUTOMATION_ORIGIN` 和 Bearer token，可以在名称不存在时创建一条具名
凭据，或读取 metadata、按 `If-Match` 更新 `ssoTgc`、删除凭据。Source Collector 不读取该表。

`/healthz` 只表示 Node 进程能够响应，`/readyz` 只检查 Ops Web 接受核心请求所需的公开 origin 和
请求状态数据库；`OPS_WEB_AUTOMATION_ORIGIN` 是自动化这条局部能力的配置，不是顶层就绪条件。local
和 development 环境不要求 Cloudflare Access 配置，缺少自动化 origin 时仅自动化 token 管理与机器
接口返回 `OPS_AUTOMATION_NOT_CONFIGURED`。生产路径没有固定测试 token 或其他 magic key。

## 界面实现

- `@campus-agent/ui` 提供语义 Token、表单控件、状态显示和 Radix 复合控件；
- `src/app/ui/` 只保留 Ops 的 SidebarLayout 和 TanStack DataTable 等应用组合；
- 业务状态到中文文案和 tone 的穷尽映射留在 `src/app/`，共享包不猜测状态；
- 路由导航使用 TanStack Router，服务端数据使用 TanStack Query，表格与长日志分别使用 TanStack
  Table 和 Virtual；
- 本地使用 Playwright 与 axe 验证代表性旅途；CI 不运行浏览器 profile，浏览器回归仅通过本地命令执行。
- Dining Studio 的 tldraw 画布保留编辑器原生工具和光标；宿主只在画布内取消会触发页面滚动的中键、空格和必要的方向键默认行为，属性输入框与工具栏控件不受影响。

Dining Studio 的 tldraw 生产许可 key 是客户端公开配置，不属于 Secret，也不应放入环境变量或服务端
日志。Hobby 许可必须保留 tldraw 水印；Trial 不显示水印，但会向 tldraw 投递许可使用信息，因此
运行时需要 CSP 的 `connect-src https://cdn.tldraw.com`。许可到期或切换 Hobby 许可时直接替换
`src/app/dining-studio/editor.tsx` 中的 key。许可规则以
[tldraw License](https://tldraw.dev/community/license) 为准。

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
pnpm --dir apps/ops-web db:apply-dining
pnpm --dir apps/ops-web db:bootstrap-dining
```

`dev` 同时启动 Vite 和 Node API；`dev:ops-web-api` 只启动 Node API，适合让 MCP 或其他本地程序
直接调用。`dev:ops-web-api-fixture` 只监听 loopback，使用内存凭据、注入式门户检查器和固定 fixture
token，启动时打印 endpoint、token 与测试凭据 ID；它不读取本地真实凭据，也不会改变生产代码或配置。
使用 MCP 验证 fixture 时，应让 MCP 与服务处于同一网络命名空间，再使用启动输出的 loopback endpoint。

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

`pnpm dev:init` 为当前 worktree 创建独立 PostgreSQL database 和 derived bucket，并生成
`.env.local`。Ops Web 使用统一 `ops_web` 角色和 `object-store-secrets`；Dining 不创建专属
角色、连接、桶或凭据。

Ops Web 的 Dining 与内部门户声明式 schema 位于 `packages/domains/dining/src/schema.ts` 和
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
- `docs/architecture/system/ui-foundation.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/ops-web/README.md`
- `docs/reference/telemetry.md`
- `docs/environment/providers.md`
