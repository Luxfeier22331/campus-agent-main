---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

Hindsight 是唯一的个人记忆内容运行时；Qdrant 只负责机构知识。个人记忆可以帮助跟进、偏好和
消歧，但不能决定身份、授权、工具开放或机构事实。聊天、个人记忆内容和账号分别拥有生命周期。

长期选择见 [Hindsight 自托管个人记忆](../../../.agents/notes/implemented/architecture/2026-07-16-hindsight.md)、
[用户身份、记忆与个性化边界](../../../.agents/notes/implemented/architecture/2026-07-16-memory-boundaries.md)
和 [Hindsight 记忆生命周期](../../../.agents/notes/implemented/architecture/2026-07-17-hindsight-lifecycle.md)。
命令运行时合同见 [个人记忆协调器与生命周期合同](../../../.agents/notes/implemented/architecture/2026-09-24-agent-memory-coordinator.md)。

## 所有权

| Owner | 唯一职责 |
| --- | --- |
| Hindsight | 内容、来源、consolidation、bank 清除和 provider operation |
| execution-control | 已准入命令的运行时状态、bank 身份、generation、profile 合成、访问屏障、call lease、provider 适配、恢复和终态化 |
| Temporal | 持久执行载体、重试和 workflow history；不拥有产品状态 |
| app-api | 用户意图、命令 outbox、产品读取投影和 HTTP 合同；不复制 Hindsight 内容，不解释 workflow history |
| campus-web | 当前用户的画像展示、纠正提交、状态展示和重试 |
| agent-runtime | 按模型调用执行 `personal_memory_recall`，格式化召回事实为模型上下文，不持有 Hindsight 凭据 |

app-api 的 callback 是加速投影的传输通道，不是执行完成的事实来源。已准入命令必须能由
execution-control 按 `command_id` 查询和恢复；callback 丢失不能永久留下 `admitted`。

## 内部模块边界

`memoryapplication` 拥有管理、命令与 receipt、访问 fence、generation drain 和追加恢复，依赖记忆
领域及窄端口；`memorypersistence` 和 `hindsightadapter` 实现存储与 provider，Temporal adapter
只负责 Activity/DTO/错误映射。管理命令和画像读取不要求存在回答 run。

运行内 recall 由 `PersonalMemoryRecallToolService` 通过共享授权器校验执行身份与工具准入，
读取冻结输入后调用只含 Recall 的
端口。Provider 返回经过数量限制和单条 UTF-8 截断的有序事实及现有字符预算；Runtime 生成中文
上下文和 `{outcome, memory_text}`，两种 runner 共用同一实现，模型仍自主决定何时召回。

回答成功后只追加本轮用户消息。`temporaladapter/answermemory` 桥接校验回答和 finalization 已完成、
读取冻结输入，并拥有 `memory.append` 步骤、attempt 与 result 投影；记忆应用通过 typed input 和
checkpoint 接口恢复 Hindsight operation，先写终态投影再释放 lease。异步提交和每次查询的 lease
准入由追加服务统一执行；同一已准入操作可跨 generation 恢复，新调用仍受当前 fence 约束。
Provider 包装器保留 recall 访问屏障，画像读取由 profile service 管理；同步追加及其旧 Activity 已删除。
这属于模块解耦：追加恢复仍依赖回答记录和输入，并未获得独立的数据保留周期。

Memory API 与 Memory Temporal Worker 独立部署；App API 的画像、命令和账户清理请求经
cluster-private-ingress 到 Memory API，Agent Runtime 的 recall Activity 直接调用 Memory API。
入口只负责固定产品路由和认证转换，不拥有记忆状态；Hindsight 的 provider 凭据只在 memory-service
及其 Worker 内部使用。
取舍见[执行与记忆职责解耦](../../../.agents/notes/implemented/architecture/2026-10-10-execution-coupling-governance.md)，
内部召回合同切换见[发布操作](../../runbooks/release/release.md#个人记忆召回合同切换)。

## 命令和生命周期

同一个 `command_id` 在产品投影和运行时分别有状态，不能把一个状态列解释成两种语义：

```text
产品投递：queued → admitted → projected | failed
运行时：  accepted → running → succeeded | failed | unknown
生命周期：active | paused | draining | erased
```

`admitted` 只表示 execution-control 已接受命令，不表示 Hindsight 已完成。`unknown` 表示
不能证明远端副作用已结束；它不是可安全删除或释放租约的失败终态。产品投影必须能够显示
运行时 `unknown`，而不是将其折叠为 `failed` 或 `succeeded`。

pause/resume 是 execution-control 的本地 runtime transition，不依赖 Hindsight。完整清除分成：

1. `BeginErase` 原子推进 generation、设置 `draining`，拒绝旧代次和新代次的所有新 Hindsight 访问；
2. `DrainAndDelete` 等待旧代次访问租约和 provider operation 达到安全终态，删除旧 bank，设置 `erased`。

普通记忆写入（`memory_add`）不能阻塞 `BeginErase`。无法确认 provider operation 已停止时保持 `draining`，
不能宣称 `erased`。

## 统一访问边界

recall、append、profile 合成读取和 erase 都必须经过同一个 memory access boundary。该边界统一处理：

- owner scope、tenant 和 user 隔离；
- 当前 generation 与 lifecycle 检查；
- call lease 的登记、恢复和释放；
- 一个逻辑操作的总 deadline；
- Hindsight provider 调用和错误映射。

生命周期行为固定为：

- `active` 允许 recall、append 和 profile 读取；
- `paused` 拒绝 recall/append，允许 profile 读取和纠正写入；
- `draining` 拒绝新的 recall、append 和 profile 读取；
- `erased` 拒绝所有个人记忆访问；产品侧返回本地终态空画像，不再转发。

产品侧清除是即时语义：app-api 接受 erase 命令后立刻把产品投影置为 `erased`，上方的
draining/`erased` 运行时阶段仍由 execution-control 在后台完成。数据面删除收敛前 `syncStatus`
保持 `pending`；生命周期命令失败由 memory 定时任务自动重试。账号注销仍以真实删除完成
（`erased` 且 `synced`）为放行条件，不使用即时投影。

管理读取只剩画像合成读取（`profile/get`），同样不能绕过 generation fence 和 drain 统计直接使用
raw Hindsight reader。state store 不可用时，个人记忆整体能力不可用；不能只依据 provider 可达
就暴露 recall。

## Provider operation 和时间

一个逻辑操作只有一个总 deadline，provider HTTP timeout、Temporal Activity timeout 和 call lease
从该预算派生。串行的 `BankExists`、recall 或画像合成读取共享同一个剩余预算。

异步 append 使用稳定的 provider operation ID；提交确认丢失时恢复同一个 operation，查询重试不
创建新的业务 attempt。只有 Hindsight 明确返回完成/失败，或明确确认 operation 已取消且不会继续
产生副作用，才可释放 append lease 和清除屏障。连接失败、`not_found` 或状态未知都不能创建
第二个业务写入，也不能提前删除 bank。

Hindsight 负责抽取、retain、recall、observation、consolidation、embedding 和原生内容生命周期。
execution-control 不复制这些内容或内部进度，只保存完成访问边界和清除所需的最小 operation identity。

## 用户管理

产品模型是整篇画像：Hindsight 把全部已准入记忆合成为一份自然语言 profile（`user-profile`
mental model，中文 source query），用户以自然语言纠正，不再逐条增删改。纠正作为普通记忆
写入，随下次合成进入画像；`refresh_after_consolidation` 让 consolidation 后自动重刷。bank
不存在时画像为空；首次合成尚未完成时返回 `generating`。产品数据库只保存用户意图、命令和
有界投影，不保存第二份可写条目镜像。

暂停保留 bank 和画像读取；恢复不换 generation，也不重新导入历史。完整清除删除来源、派生内容和
停用归档，完成后保持 `erased`/关闭。删除会话或裁剪聊天不触发记忆清理。

## 退役边界

provider-backed `owner_transition`、callback-only recovery 与 raw management reader（`items/list`、
`items/get`）已删除；`memory_update` 命令 kind 与其 item 编辑载荷也在 staging 清理中移除，未保留
历史回放兼容路径。旧 Temporal 个人记忆 workflow 停止旧执行并确认没有新任务后删除；新旧
execution-control worker 不能混跑。现有 Hindsight bank 内容不因代码切换迁移或重导入。

接口细节见 [App API 个人记忆接口](../../contracts/app-api/memory.md)。

## 相关文档

- [App API 个人记忆接口](../../contracts/app-api/memory.md)
- [Personal memory access boundary](../../../.agents/notes/implemented/architecture/2026-09-24-memory-access-boundary.md)
- [Agent 记忆协调器](../../../.agents/notes/implemented/architecture/2026-09-24-agent-memory-coordinator.md)
