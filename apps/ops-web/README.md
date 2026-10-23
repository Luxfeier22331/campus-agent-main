# ops-web

受保护的自托管运行查看与内容运营应用，由 React 页面和同源 Node 服务组成。

## 职责

- 关联 PostgreSQL 有界投影、Temporal 和 Langfuse 跳转信息；
- 读取固定范围的运行概况、运行诊断，以及 agent-control 持久化的净化步骤和尝试；
- 在运行详情读取步骤结果的独立失败输出诊断列，纯文本展示模型 JSON/结构校验失败时的可见输出；
  不读取完整业务 result payload，也不从 trace 或 receipt 补录正文；
- 在运行详情展示 Campus Search 调用进度、RAG 候选、分数、排除原因与最终引用；使用专用的有界诊断
  投影，不读取聊天事件或完整步骤结果，诊断不可用不影响产品结果展示；失败详情展示原始原因，并区分工具 HTTP 状态与 Qdrant HTTP 状态，回答完成后仍保留内部失败调用；
- 执行明确准入的在线模型配置、食堂和同好群内容运营操作；
- 直接拥有内部门户凭据池，负责真实验证、定时检查、按需显示和采集解析；
- 通过 Model Config 管理和验证在线模型当前设置；页面保留的 `execution` 路由名只是历史 URL，
  不表示 agent-control 拥有模型配置；
- 通过 App API 管理邮箱准入、用户状态和会话，并在用户详情只读显示注销状态。

浏览器只调用同源 `/api/ops/*`。本应用不是产品 API、数据库浏览器、通用观测查询或 Kubernetes
控制台。

## 页面

- `/overview`：问答概览，指标、关注请求与趋势；
- `/requests`、`/requests/:requestId`：二级运行记录与执行详情（结果、执行过程、检索与引用）；
- `/conversations`：历史会话队列与阅读工作台；宽桌面分栏、窄屏切换，可连续阅读本页会话；顶部按用户名称、邮箱、完整用户 ID 与会话内容组合搜索，时间预设直接应用，搜索条件提交后应用。
- `/conversations/:conversationId`：从运行或反馈进入的会话只读详情，可定位消息并查看各轮运行；
- `/chat-feedback`：当前回答反馈的紧凑列表和响应式详情，通过 App API 读取；数量忽略评价类型与分页、保留时间及请求条件；
- `/providers`：在线模型配置；
- `/ocr`：通知正文图片与 PDF 附件按来源聚合的当前结果、最新尝试和历史记录；支持连续结果阅读、页码跳转和通知维护跳转；Paddle 连接在模型配置页维护。
- `/internal-portal`：门户凭据与自动化 token；
- `/email-access`、`/users`、`/users/:userId`、`/users/activity`：账号管理；
- `/dining`：食堂内容维护；
- `/groups`：同好群目录维护。
- `/tasks`：通过唯一的通知流水线入口查看采集、分类和正文发布，不再列出三个旧兼容任务；调整启停与 15/30/60 分钟周期；合并定时父子执行，区分排队、执行与终态，展示步骤进度、心跳及重试信息；后续阶段执行或失败时仍保留已完成阶段的业务结果，异常终止保留最后进度与原因链；索引构建与应用由独立一次性 Job 显式执行。OCR 与凭据检查只读。
- `/notices`：查看通知库存与已采集正文、图片及附件，维护分类，并启动固定的采集、分类和发布任务。
- `/transport`：维护班车线路、完整时间段和班次明细。线路表单可独立编辑默认乘车点、下车点和乘车指引；
  后两项可留空，指引支持换行。时间段备注用于运行说明，不承担通知审核或自动提取。

路由组合位于 `src/app/ops-web-app.tsx`，浏览器 DTO 位于 `src/shared/`，HTTP 入口位于
`src/server/app.ts`。

通知 OCR 入口从通知领域读取来源资源引用，再选择正文图片与 PDF 附件创建 OCR 任务；通用 OCR 包不负责解析通知。
Node 构建内联通知 workspace 源码，但外部加载生产依赖 `jsdom`，不将其文件资源读取逻辑打入 ESM bundle。
镜像构建在独立 production deploy 目录检查所有服务端 JavaScript 的依赖边界，并实际加载和实例化 `jsdom`。

通知维护页面暴露九个固定操作：增量采集、按日期回填、补查日期范围、分类缺失通知、分类单条通知、全量重判内部通知、
发布待发布通知、发布单条通知和重新发布单条通知。分类编辑直接更新通知数据库中的唯一分类字段。部署环境的通知维护操作和定时流水线
都通过 Temporal 的固定工作流 ID `notice-pipeline-workflow` 运行；浏览器不能提交任意命令、镜像、环境变量或 namespace。
同一工作流正在运行时，新的维护提交返回冲突；分类与发布阶段仍由各自的数据库会话锁保证跨入口不重叠，锁忙时返回
`skipped`。定时调度由 Temporal `notice-pipeline` Schedule 承担，可在 `/tasks` 调整；OCR 与门户凭据检查是独立的
定时任务。

Ops Web 从 Temporal workflow result、Activity heartbeat 和 history 投影运行状态、阶段进度、处理区间、维护区间、错误和
严格业务摘要；缺少对应字段时保持 `processedRange`、`maintenanceRange`、`progress`、`error` 或 `controllerError` 为 `null`。
运行历史来自 Temporal namespace 的可见记录，不再读取通知 Job 的 Pod 日志或 Kubernetes condition。部署环境的运行记录按
Temporal run ID 查询，历史结果不参与当前工作流的互斥。
本地 `local/development` 环境使用相同任务合同启动当前 worktree 的固定 CLI，任务状态只保存在 Ops Web 进程内；服务
重启后不恢复本地任务，也不会切换到部署环境的 Temporal。

任务中心在提交维护工作流后立即显示客户端 pending 行并锁定对应的采集、分类或发布操作族；收到真实 run 后替换该行。
pending 行不是 Temporal 记录，任务列表加载或刷新失败时仍保留，避免视觉上丢失刚提交的任务。

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
- 详情通过 `agent_control.ops_terminal_failures` 受限视图区分回答终态失败与阶段失败，不授予
  原始事件读取权限；联网搜索诊断复用阶段净化 payload，仅展示 adapter 计数和固定原因；
- Node 服务内的 Ops Status、Dining、内部门户凭据和自动化 token adapter 共享一个应用级 PostgreSQL
  Pool；Dining 地图、菜单、评价和投稿分别拥有具体 store，举报复用投稿的受限读取投影；
- 页面负责 query、mutation 和用户交互编排；可独立验证的目录变换、拖拽规则和编辑器视图不与页面
  网络状态耦合；
- 跨应用集成测试通过 HTTP、共享合同或明确的 `test-support` adapter，不直接导入另一应用的
  `src/`。

## 本地命令

```bash
pnpm dev:init -- --target ops-web
pnpm --filter ops-web dev:api
pnpm --filter ops-web dev:web
pnpm --filter ops-web dev:fixture
pnpm --dir apps/ops-web start
pnpm check --filter=ops-web
pnpm build --filter=ops-web
pnpm --dir apps/ops-web test:browser
pnpm --dir apps/ops-web test:database-integration
```

`pnpm dev:init -- --target ops-web` 只准备 Ops Web 实际调用服务所需的环境、基础设施和 schema，不自动导入模型配置或业务数据。需要本地页面样例时运行 `pnpm dev:local -- data seed --domain notices --domain transport --domain dining`；各已有数据域会保留并跳过。`test:database-integration` 验证当前统一 schema 拓扑。

根 `pnpm test --filter=ops-web` 按 Node（`.test.ts`）和 DOM（`.test.tsx`）执行分组任务；有模块 mock 的文件以
`.isolated.test.*` 保留隔离，其余文件共享环境并在每个测试后清理。四组分别缓存；只有 DOM 测试
加载 jsdom 和组件清理逻辑，需要内存后端的测试显式创建 fixture。普通测试的缓存不依赖 app-api
普通测试结果，跨应用数据库 adapter 由集成任务的输入覆盖。取舍见
[Ops 测试初始化与缓存](../../.agents/notes/implemented/testing/2026-09-19-ops-test-initialization-and-cache.md)。

`dev:api` 和 `dev:web` 分别启动 Node API 与 Vite 页面；`dev:fixture` 只监听 loopback，使用内存凭据服务
和固定 fixture token，启动时打印 endpoint、token 与测试凭据 ID。它不读取本地真实凭据，也不会改变
生产代码或配置。

Dining 地图编辑器的 tldraw 公开许可证由构建环境的 `VITE_TLDRAW_LICENSE_KEY` 提供；本地 loopback
开发不设置该变量，使用 tldraw 开发模式。当前 key 是绑定 `ops.muc.wiki` 的 hobby license，各泳道共用该域名；
`staging-candidate-publish` 从仓库 secret `TLDRAW_LICENSE_KEY` 读取并传给 bake。只更换 secret 不会触发
ops-web 镜像重建，需随 ops-web 源码变更发布。部署镜像构建通过 Docker build stage 传入该变量，runtime
环境不读取它；公开 key 会按预期出现在客户端资源中，不应写入仓库源码、数据库或对象存储。

同好群和账号管理页面通过服务端配置的 `OPS_WEB_APP_API_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 调用 app-api；
前者是 HTTP(S) 根地址，令牌不下发到浏览器。

`pnpm dev:init -- --target ops-web` 为当前 worktree 创建独立 PostgreSQL database 和所需 source/derived
bucket，并生成 Ops Web 实际读取的环境文件。它不会初始化通知采集、分类和发布任务，也不会写入班车、Notice、模型或 Dining 数据；这些操作分别通过 `dev:local` 的 `schedule`、`models` 和 `data` 命令显式执行。班车由 Ops Web 直接维护，使用统一 `ops_web` 角色；Dining
不创建专属角色、连接、桶或凭据。

Ops Web 的 Dining schema 位于 `packages/domains/dining/src/schema.ts`；内部门户凭据与
automation token 表与 Dining 表的 DDL 一起由 `jobs/campus-agent-schema/` 管理，并记录在
`drizzle.campus_agent_migrations`。环境通过 `pnpm dev:init -- --target ops-web`
初始化；数据 seed 与 cluster sync 通过独立的 `dev:local data` 命令按域执行。已有数据域默认保留；显式指定该域及 `--replace` 才会替换。seed 不创建表，
食堂 SVG 由现有领域 renderer 生成。详细边界见[本地运行检查](../../docs/runbooks/local-verification.md)。

## 相关文档

- `docs/product/ops-web.md`
- `docs/product/dining.md`
- `docs/product/ui.md`
- `docs/contracts/ops-web/README.md`
- `docs/environment/providers.md`
