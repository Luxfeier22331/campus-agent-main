# Agent Note: 个人记忆协调器与生命周期合同

Status: implemented

## 背景

个人记忆命令此前同时在 app-api、execution-control、Temporal 和 Hindsight 中拥有一部分
状态。app-api 保存产品命令和生命周期，execution-control 保存 generation、receipt 和租约，
Temporal 保存 workflow 历史，Hindsight 保存远端 operation。回调丢失、workflow 终止或
provider 状态未知时，这些状态不能由一个 owner 重建，命令可能永久停在 `admitted`，清除也
无法判断旧代次是否真的排空。

[异步记忆追加](../../implemented/bug-fix/2026-09-19-async-memory-append.md) 关于稳定
provider operation ID 和未知状态不得重提的规则继续有效。

## 当前适用范围

[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)部分取代本文的执行 owner、输入保存、恢复和部署决定：
Memory API 在独立数据库中原子保存完整命令/追加输入与派发意图，Memory Worker 负责启动与恢复
`MemoryOperationWorkflow`；Control 只持久投递回答后的追加。已接收操作的恢复不再依赖
“EC 不保存输入，所以必须由 App API 重新准入”的旧前提，也不复活旧 `memory.append` Workflow。

画像产品模型、即时清除与真实删除的区别、generation/lease 屏障和未知结果不得重提的原则仍有效。
下方 2026-09-26 收敛过程保留当时的问题与取舍，不作为当前 Worker 命令或恢复操作手册；
现行路径以[个人记忆架构](../../../../docs/architecture/system/memory-plane.md)为准。

## 决策

### 产品侧即时清除（2026-09-26 更新）

普通用户清除改为即时语义：app-api 接受 erase 命令的同一事务里把 `memory_settings` 置为
`erased`（写 `erasedAt`）并推进 generation，画像读取立即返回本地空画像；数据面删除
（fence `erasing`、drain、bank 删除、24h bound）全部保留在 memory-service 后台完成。
产品合同移除 `erasing` 枚举与 409 `memory_lifecycle_blocked` 读分支。失败的生命周期命令
（owner_erase / owner_transition 失败头）由 memory 定时任务经
`listFailedLifecycleCommands` + `retryCommand` 自动重试。账号注销不采用即时语义：
`isMemoryErased` 同时要求 `lifecycleState = 'erased'` 且 `syncStatus = 'synced'`，
即真实删除收敛后才放行注销。数据库 `lifecycle_state` 无 check 约束、
`accepted_lifecycle_state` CHECK 已含 `erased`，无需迁移；遗留 `erasing` 行靠重试逻辑自愈。

### 旧实现的阻塞 receipt 收敛（2026-09-26 历史；恢复路径已被取代）

命令链此前存在三条无界路径：后继命令在 owner gate 上无限等待前置 receipt；finalizer 里
`BeginCommand` 遇 `ErrMemoryReceiptBlocked` 以无限重试死循环；erase 排空被 workflow 已死的
孤儿 receipt 永久顶住（只能走 24h drain timeout 失败）。修复不给任何组件新增 cron、表或端点，
由各自现有 owner 补上终止出口：

- **有界等待**：命令 workflow 在 `memory_command_owner_blocked` / `memory_command_receipt_active`
  上退避重试（1s 起、10s 封顶），总等待 30 分钟后以 `memory_command_wait_timeout` 失败终态化。
  30 分钟超过所有活跃重试链；等待中的 workflow 每次重试都真实探测 gate，不引入轮询组件。
- **receipt 陈旧判定**：receipt 增加 `updated_at` 触碰时间（每次状态迁移都刷新）。非终态且
  超过 `memoryruntime.CommandReceiptStaleAfter`（10 分钟）未被触碰的 receipt 判为 stale。
  这只是本地恢复信号，不能证明 workflow 或 provider operation 已停止；判定只由
  execution-control 做，status 接口只暴露 `stale` 布尔值，app-api 不重复计算。
- **app-api 重新准入**：memory 定时 reconcile 对非终态且 `stale` 的已准入命令重新 `admit`
  （同 workflow ID，`AlreadyStarted` 被吞掉，要么恢复要么 no-op），与既有 404 `command_not_found`
  重新准入同形态。恢复必须由 app-api 执行，因为 EC receipt 刻意不保存命令 payload（隐私约束）。
- **finalizer 不再创建 receipt**：finalizer 移除 `BeginCommand`，只终态化 provider 已创建的
  receipt；缺失 receipt（`ErrMemoryCommandNotFound`）直接放行结果到 callback，由上述 404
  重新准入路径兜底。同时 `FinalizeCommand` 对缺失 receipt 从 `ErrMemoryFenceConflict` 改为
  `ErrMemoryCommandNotFound`，finalizer 据此区分"没赶上"与"身份冲突"。
- **erase 排空保留未决 receipt**：旧决定曾把超过 10 分钟未触碰的 receipt 终态化；这把本地
  触碰间隔误当成 provider operation 已停止的证据。现由[命令结果不确定性修复](./2026-10-10-memory-command-uncertainty.md)
  取代：stale 只触发同一 command 的重新准入和恢复，不能释放旧 generation 的排空屏障。
  其余旧收敛实现的适用范围以本篇开头的取代说明为准，不再据此要求 App API 恢复已被 Memory 接收的操作。

取舍：崩溃或恢复重放后 provider 可能 at-least-once 执行，与既有 SDK activity 重试语义一致；
双重追加受 supersession/fence 约束且终结。`(owner_scope_hash, generation)` 索引仍为规模
gated，不在此修复。

### 所有权

- app-api 拥有用户意图、outbox 和产品读取投影，不拥有已准入命令的执行状态。
- memory-service 是已准入命令的唯一运行时 owner，负责 command receipt、workflow/provider
  identity、generation、profile 合成、call lease、恢复和终态化。
- Temporal 是持久执行载体和历史保存者，不建立另一套产品状态。
- Hindsight 是记忆内容和 provider operation 的唯一 owner。

回调只用于尽快更新 app-api 投影。app-api 能按 `command_id` 从 memory-service 查询
运行时状态，回调失败不使命令永久停在 `admitted`。

### 状态

产品投影和运行时状态分开表达。产品命令 `status` 使用 `pending_admission | admitted | failed`，
公开命令字段见[接口合同](../../../../docs/contracts/app-api/memory.md)。`admitted` 只表示 Memory
接受命令，不表示 provider 已完成。运行时 `unknown` 不是产品状态枚举，表示不能证明远端副作用
已结束，不释放相关 lease，也不完成旧 bank 的物理删除。

### 产品模型

产品合同从逐条 CRUD 收敛为整篇画像：memory-service 通过 Hindsight `user-profile`
mental model（中文 source query，`refresh_after_consolidation`）把全部已准入记忆合成一份
自然语言 profile；用户提交自然语言纠正（`POST /corrections`），纠正作为普通记忆写入并随
下次合成进入画像。逐条 list/get/create/update 路由从 app-api 与 campus-web 合同中移除；
硬切前需确认没有历史失败行依赖；`memory_update` 命令 kind 与其 item 编辑载荷
（`state`/`memoryId`）、`items/list`、`items/get` 管理 read 路由及对应错误码
（`profile_memory_item_not_found`、`memory_edit_rejected`）一并从合同与实现中删除。

### 生命周期屏障

pause/resume 是 memory-service 的本地 runtime transition，不经过 Hindsight provider。
清除分成两个动作：`BeginErase` 立即推进 generation、进入 `draining` 并拒绝新的访问；
`DrainAndDelete` 等待旧代次调用及 provider operation 达到安全终态后删除 bank 并进入
`erased`。排空上界 24 小时，超时以失败暴露而不是无限等待；当前由 Memory 恢复已持久接收的
操作，沿用稳定 provider operation ID，不再依赖旧 append Workflow 的复活路径。

recall、append、profile 读取和 erase 都经过同一个 memory access boundary，统一执行 owner
scope、generation、lifecycle、call lease 和总 deadline。`paused` 允许 profile 读取和纠正
写入但拒绝 recall/append；`draining` 拒绝 profile 读取（409 `memory_lifecycle_blocked`）；
`erased` 由 app-api 返回本地终态空画像，不再转发。

### 时间与 provider operation

每个逻辑操作只有一个总 deadline，provider HTTP timeout、Temporal Activity timeout 和
call lease 由此派生。异步 append 保存稳定 provider operation ID；查询重试不创建新的业务
attempt。只有 provider 明确终态，或明确确认副作用已停止，才释放排空屏障。

画像读取由 Hindsight adapter 投影原生 `refresh_mental_model` operation，按 `mental_model_id`
选择当前用户画像任务；先读任务状态，再读模型，避免把任务完成与之前读取的占位正文拼接。
首次创建的模型已有正文和时间戳，但没有生成结果；以完整模型的 `reflect_response.text`
区分初始占位与已生成内容。pending/processing 返回 generating，失败通过已有读取错误表达，
不匹配正文关键词、不保存第二套任务生命周期。已有正文在再次生成期间保留。
Campus Web 在 generating 时刷新画像，完成或读取失败后停止；生成中与空画像分别展示，
正文复用安全 Markdown 渲染。真实生成状态由适配器负责，前端不推断上游任务。

## 未采用方案

- **继续让 app-api 通过 callback 推断执行终态**：实现简单，但 callback 不是可靠恢复机制，无法
  处理 workflow 已结束、callback 丢失和 provider 状态未知。
- **为每个状态表增加独立 reconciler 或 cron**：可以缓解单个卡住状态，却会继续扩大状态 owner，
  让多个 reconciler 竞争同一命令；最初集中到 execution-control，现由独立 Memory owner 的派发、恢复与排空路径承担。
- **让 Temporal 成为产品状态 owner**：workflow history 适合持久执行，不适合直接承担产品投影，
  也会把 app-api 与 Temporal schema 绑定。
- **把 provider `unknown` 当作失败并释放清除**：可能在远端仍写入时删除 bank，破坏用户数据和
  generation 隔离。
- **逐条 CRUD 管理界面（方案 A）**：可复用现有 items 基础设施，但把 Hindsight 抽取、consolidation
  的派生结构暴露给用户，纠正粒度与合成机制冲突；整篇画像 + 自然语言纠正与产品心智一致。
- **quarantine、运维处置端点、常驻 sweep、Postgres 迁移**：均为协调器提案评审中裁剪的范围；
  这是当时协调器评审的范围取舍；后续独立数据库与恢复机制由服务拆分决策明确取代。

## 后果

任意已准入命令都能按 `command_id` 查询唯一运行时事实；callback 丢失不会永久留下
`admitted`。pause/resume 不依赖 Hindsight 可用性；`BeginErase` 不被普通命令排队阻塞，
`draining` 后新的 recall、append、profile 读取被拒绝，已有调用能被排空统计覆盖；一个逻辑
操作的 deadline、Activity timeout 和 lease 不会互相独立到期；provider 状态未知时不重复
提交、不释放 lease、不删除 bank。

旧 Temporal history 不能由新 workflow 直接解释时，需在发布前停止并收口明确属于个人记忆的
旧执行；不能混用不兼容的 Memory Worker。原 execution-control 的 Go Worker 已退役，
当前发布由独立服务合同维护。现有 Hindsight bank 内容不因代码切换迁移或重导入。Hindsight 无法确认 operation 已停止时，用户清除在数据面保持 `draining` 并以失败暴露，
不静默宣称 `erased`；产品投影在 erase 入队时即置为 `erased`（即时清除，见上方 2026-09-26
更新），数据面收敛由 `syncStatus` 表达。旧客户端（逐条 items 路由）在硬切期间收到 404，不保留兼容层。

历史实现的验证记录（对应当时模块，不能作为当前执行命令）：`go test ./apps/agent-control/...`（合同、fence、profile handler、排空与
复活）、execution-control `test:database-integration`（含多实例并发：同一 erase 命令并发准入
仅执行一次、并发 owner 删除幂等、新调用不得穿越已提交的删除）、app-api `test:node:fast` /
`test:node:isolated` / `test:shared-db-integration`、campus-web `test:node:*` / `test:dom:*` /
`test:worker`。并发测试发现并修复了 `BeginCall` fence 行引导的竞态：先 `select for update`
再普通 `insert` 后触发 duplicate key；现与 `BeginCommand` 一致，改为
`insert on conflict do nothing` 后加锁读取。阻塞 receipt 收敛（2026-09-26 更新）新增验证：
workflow 有界等待超时（Temporal test suite 模拟时间）、finalizer 缺失 receipt 放行、
erase 排空放弃陈旧 receipt（当时的 adaptertest + in-memory 测试；该行为已被未知结果修复取代）、status `stale` 标志、
app-api 对 stale/404 重新准入（vitest）。覆盖缺口：真实 Hindsight 供应商的 profile 合成
延迟未在 CI 覆盖。

## 相关文档

- [个人记忆访问边界](./2026-09-24-memory-access-boundary.md)
- [个人记忆架构](../../../../docs/architecture/system/memory-plane.md)
- [App API 个人记忆接口](../../../../docs/contracts/app-api/memory.md)
- [Hindsight 自托管个人记忆](./2026-07-16-hindsight.md)
- [Hindsight 记忆生命周期](./2026-07-17-hindsight-lifecycle.md)
- [异步记忆追加](../../implemented/bug-fix/2026-09-19-async-memory-append.md)
- [命令结果不确定性修复](./2026-10-10-memory-command-uncertainty.md)

### 持久化配置随发布升级

画像和 bank 中的指令属于应用配置，不能仅在首次创建时应用。Memory 负责默认值、实际 HTTP
序列化和配置升级；GitOps 在新 workload 就绪后执行同镜像的 PostSync Job，覆盖已有对象。
正常请求不增加配置查询。纠正采用最新明确表述，要求撤回的内容从当前画像中省略，
不通过作废说明复述，也不将自然语言纠正转换为底层删除。

部署合同按实际 Hindsight API 实现：bank 列表不分页，画像 API 未暴露最后合成指令；
升级过程中关闭该画像的整合后自动刷新，等待旧任务结束，再显式刷新，成功才恢复。
失败重跑复用该字段识别未完成对象，不增加独立台账。配置一致且自动刷新已恢复时跳过。
新建 bank 的 HTTP 请求和回读必须包含 `retain_mission`，不能只测试内部配置结构。

实际发布发现候选计划仍使用拆分前的 base 清单，Memory 镜像已更新但 Kubernetes ref 未推进，
因此 PostSync Job 没有部署。发布选择补齐 Agent Control、Agent Runtime、Memory 和私有入口的
独立 base，并验证仅清单变化也会选中；已经越过发布游标的 Memory base 由 GitOps 显式推进。
升级 Job 实测在 Pod 启动瞬间连接被拒绝，同标签探针两秒后恢复；命令在任何写入前对首次
bank 查询的连接拒绝最多等待 30 秒，不扩大到配置写入或刷新提交的重试。
