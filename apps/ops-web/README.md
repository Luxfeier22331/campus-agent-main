# ops-web

受保护的自托管运行查看与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行记录，以及 execution-control 持久化的净化步骤和尝试；
- 在运行详情读取步骤结果的独立失败输出诊断列，纯文本展示模型 JSON/结构校验失败时的可见输出；
  不读取完整业务 result payload，也不从 trace 或 receipt 补录正文；
- 在运行详情展示 Campus Search 调用进度、RAG 候选、分数、排除原因与最终引用；使用专用的有界诊断
  投影，不读取聊天事件或完整步骤结果，诊断不可用不影响产品结果展示；
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
- `/conversations/:conversationId`：从运行或反馈进入的会话只读详情，可定位消息并查看各轮运行；
- `/chat-feedback`：当前回答反馈的筛选、数量统计和对应问答详情，通过 App API 读取；
- `/providers`：在线模型配置；
- `/ocr`：通知图片/PDF 识别任务与分页结果；Paddle 连接在模型配置页维护。
- `/internal-portal`：门户凭据与自动化 token；
- `/email-access`、`/users`、`/users/:userId`、`/users/activity`：账号管理；
- `/dining`：食堂内容维护；
- `/groups`：同好群目录维护。
- `/notices`：查看通知库存与已采集正文、图片及附件，维护分类，并启动固定的采集、分类和发布任务。
- `/transport`：维护班车线路、完整时间段和班次明细。线路表单可独立编辑默认乘车点、下车点和乘车指引；
  后两项可留空，指引支持换行。时间段备注用于运行说明，不承担通知审核或自动提取。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器 DTO 位于 `src/shared/`，HTTP 入口位于
`src/server/app.ts`。

通知 OCR 入口从通知领域读取来源资源引用，再选择图片/PDF 创建 OCR 任务；通用 OCR 包不负责解析通知。
Node 构建内联通知 workspace 源码，但外部加载生产依赖 `jsdom`，不将其文件资源读取逻辑打入 ESM bundle。
镜像构建在独立 production deploy 目录检查所有服务端 JavaScript 的依赖边界，并实际加载和实例化 `jsdom`。

通知维护页面只暴露七个固定操作：增量采集、按日期回填、分类缺失通知、分类单条通知、发布待发布通知、
发布单条通知和重新发布单条通知。分类编辑直接更新通知数据库中的唯一分类字段。部署环境的服务端从
同一 namespace 的现有 CronJob `spec.jobTemplate` 创建一次性 Job；浏览器不能
提交任意 command、image、environment、namespace 或 Secret。每个采集、分类和发布操作族同时只允许
一个待运行或运行中的 Job，不排队、不自动串联、不自动重试。GitOps 只管理暂停的 CronJob 模板；动态
Job 引用来源 CronJob 作为 owner，固定零重试，并在完成 24 小时后回收。

Job 的 stdout 使用结构化 JSON。Ops Web 读取运行中、成功和失败 Job 的 Pod 输出，返回 Kubernetes
状态、本次处理区间、完成后维护区间、最近阶段/进度、原始应用错误、controller condition、严格业务摘要和单条任务的通知 ID label；
没有对应日志字段时保持 `processedRange`、`maintenanceRange`、`progress`、`error` 或 `controllerError` 为 `null`，不从日志或 Job
名称推测处理数量及通知归属。页面分别显示活动任务与成功或失败的历史结果，历史结果不参与任务互斥。
Job 只保留短期排障证据，当前不持久化超过 24 小时的执行历史。调试阶段错误不做泛化、脱敏或截断。
本地 `local/development` 环境使用同一任务合同启动当前 worktree 的固定 Job CLI，任务状态只保存在 Ops Web
进程内；服务重启后不恢复本地任务，也不会回退到 Kubernetes。

任务中心在提交一次性 Job 后立即显示客户端 pending 行并锁定对应的采集、分类或发布操作族；收到真实 Job
后替换该行。pending 行不是 Kubernetes 记录，任务列表加载或刷新失败时仍保留，避免视觉上丢失刚提交的任务。

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
- 详情通过 `execution_control.ops_terminal_failures` 受限视图区分回答终态失败与阶段失败，不授予
  原始事件读取权限；联网搜索诊断复用阶段净化 payload，仅展示 adapter 计数和固定原因；
- Node 服务内的 Ops Status、Dining、内部门户凭据和自动化 token adapter 共享一个应用级 PostgreSQL
  Pool；Dining 地图、菜单和评价仍分别拥有具体 store，不互相导入具体实现；
- 页面负责 query、mutation 和用户交互编排；可独立验证的目录变换、拖拽规则和编辑器视图不与页面
  网络状态耦合；
- 跨应用集成测试通过 HTTP、共享合同或明确的 `test-support` adapter，不直接导入另一应用的
  `src/`。

## 本地命令

```bash
pnpm dev:shared-reconcile
pnpm dev:init -- --target ops-web
pnpm --filter ops-web dev:api
pnpm --filter ops-web dev:web
pnpm --filter ops-web dev:fixture
pnpm --dir apps/ops-web start
pnpm --dir apps/ops-web check
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
```

`pnpm dev:init -- --target ops-web` 会生成 core、Ops Web 和通知相关实际消费者所需的环境投影，通过
`campus-agent-schema` 安装统一 schema 和授权，再写入班车 baseline、通知分类与 Dining 本地 seed；
新的本地 profile 不需要单独初始化 notice-publisher。`test:database-integration` 验证当前统一 schema 拓扑。

`dev:api` 和 `dev:web` 分别启动 Node API 与 Vite 页面；`dev:fixture` 只监听 loopback，使用内存凭据服务
和固定 fixture token，启动时打印 endpoint、token 与测试凭据 ID。它不读取本地真实凭据，也不会改变
生产代码或配置。

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

`pnpm dev:init -- --target ops-web` 为当前 worktree 创建独立 PostgreSQL database 和所需 source/derived
bucket，生成 Ops Web 及通知采集、分类、发布任务实际读取的环境文件，并通过统一 schema 和 seed owner 补齐
班车 baseline、Notice、分类模型与 Dining 本地基线。班车由 Ops Web 直接维护，使用统一 `ops_web` 角色；Dining
不创建专属角色、连接、桶或凭据。

Ops Web 的 Dining、内部门户凭据与 automation token 声明式 schema 位于
`packages/domains/dining/src/schema.ts` 和 `apps/ops-web/ops/db/internal-portal-schema.ts`，对应的
DDL 与其他产品 schema 一起由 `jobs/campus-agent-schema/` 管理，并记录在
`drizzle.campus_agent_migrations`。`db:bootstrap-dining` 只写入
Dining 基线草稿，并通过正式 publisher 上传 SVG、原子写入 release 和当前 publication；已有有效
发布时不修改数据。授权和 bootstrap 不建表，也不维护 migration ledger。

```bash
pnpm --dir apps/ops-web db:bootstrap-transport
pnpm --dir apps/ops-web db:bootstrap-dining
```

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/product/ui.md`
- `docs/contracts/ops-web/README.md`
- `docs/environment/providers.md`
