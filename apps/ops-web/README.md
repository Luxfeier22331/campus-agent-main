# ops-web

受保护的自托管运行查看与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal、Sentry 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录，以及 execution-control 持久化的净化步骤和尝试；
- 通过服务端固定查询访问 Sentry，不向浏览器提供任意供应商查询；
- 执行明确准入的在线模型配置、食堂和同好群内容运营操作；
- 直接拥有内部门户凭据池，负责真实验证、定时检查、按需显示和采集解析；
- 通过 Model Config 管理和验证在线模型当前设置；页面保留的 `execution` 路由名只是历史 URL，
  不表示 execution-control 拥有模型配置；
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
- `/notices`：查看通知库存、维护分类，并启动固定的采集、分类和发布任务。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器 DTO 位于 `src/shared/`，HTTP 入口位于
`src/server/app.ts`。

通知维护页面只暴露六个固定操作：增量采集、按日期回填、分类缺失通知、分类单条通知、发布待发布通知和
发布单条通知。分类编辑直接更新通知数据库中的唯一分类字段。服务端从同一 namespace 的现有 CronJob `spec.jobTemplate` 创建一次性 Job；浏览器不能
提交任意 command、image、environment、namespace 或 Secret。每个采集、分类和发布操作族同时只允许
一个待运行或运行中的 Job，不排队、不自动串联、不自动重试。GitOps 只管理暂停的 CronJob 模板；动态
Job 引用来源 CronJob 作为 owner，固定零重试，并在完成 24 小时后回收。

Job 的 stdout 使用结构化 JSON。Ops Web 读取运行中、成功和失败 Job 的 Pod 输出，返回 Kubernetes
状态、有效维护区间、最近阶段/进度、原始应用错误、controller condition、摘要和单条任务的通知 ID label；
没有对应日志字段时保持 `range`、`progress`、`error` 或 `controllerError` 为 `null`，不从日志或 Job
名称推测处理数量及通知归属。页面分别显示活动任务与成功或失败的历史结果，历史结果不参与任务互斥。
Job 只保留短期排障证据，当前不持久化超过 24 小时的执行历史。调试阶段错误不做泛化、脱敏或截断。

`/internal-portal` 还管理多条开发者自动化 token。人工管理接口继续使用 Cloudflare Access；开发者
程序使用环境配置的 `OPS_WEB_AUTOMATION_ORIGIN` 和 Bearer token，可以在名称不存在时创建一条具名
凭据，或读取 metadata、按 `If-Match` 更新 `ssoTgc`、删除凭据。Ops Web 直接持久化 TGC、检查结果和
候选解析，不通过另一个凭据服务转发。internal-portal-collection 通过 `OPS_WEB_INTERNAL_URL` 调用
Ops Web 的内部解析接口。

## 内部边界

- Ops Status 的合同、环境组装、不可用实现和 PostgreSQL adapter 分离；路由只依赖 store 合同，不
  反向拥有数据库或外部平台配置；
- 运行列表只读取产品摘要和最新执行阶段，详情才读取完整净化步骤与尝试；Ops Web 不能读取
  `agent_run_events`、`agent_step_results` 或旧 `runtime.*` 视图；
- Node 服务内的 Ops Status、Dining、内部门户凭据和自动化 token adapter 共享一个应用级 PostgreSQL
  Pool；Dining 地图、菜单和评价仍分别拥有具体 store，不互相导入具体实现；
- 页面负责 query、mutation 和用户交互编排；可独立验证的目录变换、拖拽规则和编辑器视图不与页面
  网络状态耦合；
- 跨应用集成测试通过 HTTP、共享合同或明确的 `test-support` adapter，不直接导入另一应用的
  `src/`。

## 本地命令

```bash
pnpm dev:init
pnpm --filter ops-web dev:init
pnpm --filter ops-web dev:api
pnpm --filter ops-web dev:web
pnpm --filter ops-web dev:fixture
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
pnpm --dir apps/ops-web db:check
pnpm --dir apps/ops-web db:generate
```

`ops-web dev:init` 会先通过 `campus-agent-schema` 安装统一 schema 和授权，再写入通知分类与 Dining
本地 seed；新的本地 profile 不需要单独初始化 notice-publisher。

`dev:api` 和 `dev:web` 分别启动 Node API 与 Vite 页面；`dev:fixture` 只监听 loopback，使用内存凭据服务
和固定 fixture token，启动时打印 endpoint、token 与测试凭据 ID。它不读取本地真实凭据，也不会改变
生产代码或配置。

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

`pnpm dev:init` 为当前 worktree 创建独立 PostgreSQL database 和 derived bucket，并生成
`.env.local`。Ops Web 使用统一 `ops_web` 角色和 `object-store-secrets`；Dining 不创建专属
角色、连接、桶或凭据。

Ops Web 的 Dining、内部门户凭据与 automation token 声明式 schema 位于
`packages/domains/dining/src/schema.ts` 和 `apps/ops-web/ops/db/internal-portal-schema.ts`，生成的
migration 与其他产品 schema 一起由 `jobs/campus-agent-schema/` 管理，并记录在
`drizzle.campus_agent_migrations`。`apps/ops-web/drizzle/`、`db:apply-dining` 和 `db:apply` 暂作为现有
部署环境的不可变历史入口保留，不再参与新建本地数据库 bootstrap。`db:bootstrap-dining` 只写入
Dining 基线草稿，并通过正式 publisher 上传 SVG、原子写入 release 和当前 publication；已有有效
发布时不修改数据。授权和 bootstrap 不建表，也不维护 migration ledger。

```bash
pnpm --dir apps/ops-web db:bootstrap-dining
```

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/product/ui.md`
- `docs/contracts/ops-web/README.md`
- `docs/environment/providers.md`
