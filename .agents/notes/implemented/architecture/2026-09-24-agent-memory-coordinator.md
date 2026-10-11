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

## 决策

### 产品侧即时清除（2026-09-26 更新）

普通用户清除改为即时语义：app-api 接受 erase 命令的同一事务里把 `memory_settings` 置为
`erased`（写 `erasedAt`）并推进 generation，画像读取立即返回本地空画像；数据面删除
（fence `erasing`、drain、bank 删除、24h bound）全部保留在 execution-control 后台完成。
产品合同移除 `erasing` 枚举与 409 `memory_lifecycle_blocked` 读分支。失败的生命周期命令
（owner_erase / owner_transition 失败头）由 memory 定时任务经
`listFailedLifecycleCommands` + `retryCommand` 自动重试。账号注销不采用即时语义：
`isMemoryErased` 同时要求 `lifecycleState = 'erased'` 且 `syncStatus = 'synced'`，
即真实删除收敛后才放行注销。数据库 `lifecycle_state` 无 check 约束、
`accepted_lifecycle_state` CHECK 已含 `erased`，无需迁移；遗留 `erasing` 行靠重试逻辑自愈。

### 阻塞 receipt 的收敛（2026-09-26 更新；erase 陈旧 receipt 决定已被取代）

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
  其他收敛决定（有界 owner gate 等待、receipt stale 判定、app-api 同命令重新准入、finalizer
  不创建 receipt）仍有效。

取舍：崩溃或恢复重放后 provider 可能 at-least-once 执行，与既有 SDK activity 重试语义一致；
双重追加受 supersession/fence 约束且终结。`(owner_scope_hash, generation)` 索引仍为规模
gated，不在此修复。

### 所有权

- app-api 拥有用户意图、outbox 和产品读取投影，不拥有已准入命令的执行状态。
- execution-control 是已准入命令的唯一运行时 owner，负责 command receipt、workflow/provider
  identity、generation、profile 合成、call lease、恢复和终态化。
- Temporal 是持久执行载体和历史保存者，不建立另一套产品状态。
- Hindsight 是记忆内容和 provider operation 的唯一 owner。

回调只用于尽快更新 app-api 投影。app-api 能按 `command_id` 从 execution-control 重建
运行时状态，回调失败不使命令永久停在 `admitted`。

### 状态

产品投影和运行时状态分开表达：

```text
产品 delivery: queued | admitted | projected | failed
运行时:        accepted | running | succeeded | failed | unknown
生命周期:      active | paused | draining | erased
```

`admitted` 只表示 execution-control 接受命令；不表示 provider 已完成。`unknown` 表示
不能证明远端副作用已结束，不释放相关 lease，也不完成旧 bank 的物理删除。

### 产品模型

产品合同从逐条 CRUD 收敛为整篇画像：execution-control 通过 Hindsight `user-profile`
mental model（中文 source query，`refresh_after_consolidation`）把全部已准入记忆合成一份
自然语言 profile；用户提交自然语言纠正（`POST /corrections`），纠正作为普通记忆写入并随
下次合成进入画像。逐条 list/get/create/update 路由从 app-api 与 campus-web 合同中移除；
硬切前需确认没有历史失败行依赖；`memory_update` 命令 kind 与其 item 编辑载荷
（`state`/`memoryId`）、`items/list`、`items/get` 管理 read 路由及对应错误码
（`profile_memory_item_not_found`、`memory_edit_rejected`）一并从合同与实现中删除。

### 生命周期屏障

pause/resume 是 execution-control 的本地 runtime transition，不经过 Hindsight provider。
清除分成两个动作：`BeginErase` 立即推进 generation、进入 `draining` 并拒绝新的访问；
`DrainAndDelete` 等待旧代次调用及 provider operation 达到安全终态后删除 bank 并进入
`erased`。排空上界 24 小时，超时以失败暴露而不是无限等待；等待期间复活丢失的 append
workflow（确定性 operation ID，`Submitted=false`）。

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
  让多个 reconciler 竞争同一命令；恢复集中在 execution-control 的排空与复活路径。
- **让 Temporal 成为产品状态 owner**：workflow history 适合持久执行，不适合直接承担产品投影，
  也会把 app-api 与 Temporal schema 绑定。
- **把 provider `unknown` 当作失败并释放清除**：可能在远端仍写入时删除 bank，破坏用户数据和
  generation 隔离。
- **逐条 CRUD 管理界面（方案 A）**：可复用现有 items 基础设施，但把 Hindsight 抽取、consolidation
  的派生结构暴露给用户，纠正粒度与合成机制冲突；整篇画像 + 自然语言纠正与产品心智一致。
- **quarantine、运维处置端点、常驻 sweep、Postgres 迁移**：均为协调器提案评审中裁剪的范围；
  恢复由排空等待、workflow 复活和按 command ID 的 receipt 查询覆盖，不再引入独立机制。

## 后果

任意已准入命令都能按 `command_id` 查询唯一运行时事实；callback 丢失不会永久留下
`admitted`。pause/resume 不依赖 Hindsight 可用性；`BeginErase` 不被普通命令排队阻塞，
`draining` 后新的 recall、append、profile 读取被拒绝，已有调用能被排空统计覆盖；一个逻辑
操作的 deadline、Activity timeout 和 lease 不会互相独立到期；provider 状态未知时不重复
提交、不释放 lease、不删除 bank。

旧 Temporal history 不能由新 workflow 直接解释时，需在发布前停止并收口明确属于个人记忆的
旧执行；新旧 execution-control worker 不能混跑。现有 Hindsight bank 内容不因代码切换迁移或
重导入。Hindsight 无法确认 operation 已停止时，用户清除在数据面保持 `draining` 并以失败暴露，
不静默宣称 `erased`；产品投影在 erase 入队时即置为 `erased`（即时清除，见上方 2026-09-26
更新），数据面收敛由 `syncStatus` 表达。旧客户端（逐条 items 路由）在硬切期间收到 404，不保留兼容层。

已落实的验证：`go test ./apps/execution-control/...`（合同、fence、profile handler、排空与
复活）、execution-control `test:database-integration`（含多实例并发：同一 erase 命令并发准入
仅执行一次、并发 owner 删除幂等、新调用不得穿越已提交的删除）、app-api `test:node:fast` /
`test:node:isolated` / `test:shared-db-integration`、campus-web `test:node:*` / `test:dom:*` /
`test:worker`。并发测试发现并修复了 `BeginCall` fence 行引导的竞态：先 `select for update`
再普通 `insert` 后触发 duplicate key；现与 `BeginCommand` 一致，改为
`insert on conflict do nothing` 后加锁读取。阻塞 receipt 收敛（2026-09-26 更新）新增验证：
workflow 有界等待超时（Temporal test suite 模拟时间）、finalizer 缺失 receipt 放行、
erase 排空放弃陈旧 receipt（adaptertest + in-memory 状态存储）、status `stale` 标志、
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
