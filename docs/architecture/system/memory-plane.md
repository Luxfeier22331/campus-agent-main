---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

Hindsight 是唯一个人记忆运行时；Qdrant 只负责机构知识。记忆辅助理解个人偏好、背景与指代，
不决定身份、授权、工具开放或机构事实。聊天和记忆有独立生命周期。

所有权决策见 [Hindsight 自托管个人记忆](../../../.agents/notes/implemented/architecture/2026-07-16-hindsight.md)；个人记忆与会话上下文边界见
[用户身份、记忆与个性化边界](../../../.agents/notes/implemented/architecture/2026-07-16-memory-boundaries.md)。记忆不能覆盖实体识别结果，见
[实体别名](../../../.agents/notes/implemented/architecture/2026-07-16-entity-aliases.md)。

## 所有权

| Owner | 职责 |
| --- | --- |
| Hindsight | 内容、原生事实编辑/停用/恢复、来源、派生观察、consolidation、bank 清除 |
| execution-control | bank 身份派生、SDK 适配、generation fence、在途租约、命令回执 |
| Temporal | 命令串行执行、回答后的独立追加任务、提交确认与状态查询恢复、终态投影 |
| app-api | 当前用户接口、生命周期、命令 outbox；不复制记忆内容列表 |
| campus-web | 原生内容管理、条目级待处理状态及重试、暂停与完整清除 |
| ops-web | 已有 step/attempt 投影上的后台追加进度，不代理 Hindsight 内部任务 |
| agent-runtime | 按需调用 personal_memory_recall，不持有 Hindsight 凭据 |

app-api 通过 execution-control 的内部接口读取或提交命令。Hindsight 的端点与模型配置独立于
聊天模型，见 [Provider 配置](../../environment/providers.md)。本项目不重新实现记忆抽取、向量化、
去重或派生观察，也不建立另一份可写内容投影。

## 身份和执行

bank 从稳定环境 salt、tenant、user ID 和 generation 派生。默认 tenant 为 tenant-main。
会话追加使用确定性的 conversation/message document ID；手工添加使用确定性的 profile document ID，
重试同一个添加命令不会生成另一个来源。写入仅在 bank 不存在时创建并设置既有 Memory Defense 策略；
recall 不创建 bank。

聊天准入冻结 recall_enabled、append_enabled 和 generation。普通命令序号只排序管理命令，
不传入聊天调用、不比较命令序号来拒绝已经准入的 recall/append。暂停/清除仍通过 owner lifecycle
和 generation 阻止不允许的调用；清除等待已开始的旧代次调用排空。

recall 在 Agent 的普通工具调用中执行，使用当前用户范围和 accepted message 时间。
无匹配不代表用户事实不存在；依赖失败返回失败工具结果，不阻止与记忆无关的回答，也不为了弥补
个人记忆失败触发联网搜索。机构知识仍需 campus_search 或合适的当轮来源。

回答提交后才追加当前用户消息，不追加助手回答。追加使用原生异步 retain 和 private observation scope。
调用方根据 bank、generation 和消息 document ID 派生稳定的 operation UUID；提交确认丢失时复用该 ID，
不创建第二个远端任务。错误不能回滚已经完成的回答。失败/取消的产品请求不追加。

回答工作流等待 `MemoryAppendWorkflow` 启动成功后返回，子工作流采用 ABANDON，
不继承回答的 900 秒期限。追加写入和状态查询共享 300 秒的单次 HTTP 上限与执行窗口，
网络失败按 2 秒起步、最多 30 秒间隔恢复；每 10 秒查询原任务，等待不占用 Activity slot。
历史达到 Temporal 建议阈值时 Continue-As-New，保留同一任务身份和提交阶段。

记忆提取模型请求期限为 300 秒，由 Hindsight 负责模型及任务内部重试；继续保留其 3600 秒
整项任务保护。外层不把 pending、processing、查询失败或 not_found 当成写入最终失败。
Hindsight 明确终态后才结束跟踪；最终失败不调用额外的任务重试。

后台追加使用已有调用登记表中 `expires_at IS NULL` 的记录，提交前登记，终态投影完成后释放。
该形式只允许 append 使用；读取仍使用有期限租约。相同 owner、generation、call ID 可以恢复已有登记，
新登记仍需通过当前 generation fence。清除等待此登记释放，不能因 HTTP 超时或 Worker 重启提前删除 bank。

## 用户管理

管理页统一展示原生 fact、experience 和 summary；来源标为手工、会话、派生或未知。
事实和经历可以修改、停用和恢复。停用是原生 invalidated，排除召回但保留可恢复归档。
summary 只读，展开支持事实并在事实上操作，由 Hindsight 更新派生内容，不手工改写派生观察。
没有来源时不伪造对应聊天记录。

暂停保留 bank 和管理能力，关闭后续 recall/append。恢复不换代，也不重新导入历史消息。
完整清除递增代次、排空旧调用、删除旧 bank（含来源、派生内容和归档）；成功后仍关闭。
账号注销在完成这些清理后再完成账号删除；原有账号隔离不因普通管理简化而移除。

**会话删除、批量删除和裁剪不产生记忆命令。**产品不承诺它们清除已提取记忆。
单条物理删除 API、来源删除批次和 subject-drain 已退役。

## 状态和诊断

app-api 只保存 lifecycle、命令及其待执行正文；成功后清空正文，失败时保留供显式重试，
完整清除会移除所有命令正文。普通修改 pending 不关闭整库读取，失败显示在对应命令/条目。
生命周期 syncStatus 与普通命令状态分开。

回调保存命令终态后继续派发下一条；定时任务之间互不阻塞。页面只在存在未完成命令时轮询，
查询和缓存按用户隔离，完成时刷新实际 bank 内容；不把接受命令当作修改完成。

memory.append 在完成投影前登记 pending，提交前投影 running。新的异步路径将一次远端任务投影为
一个业务 attempt；查询的重试次数不覆盖业务 attempt，不为每轮查询新增 step。
接收任务不算 completed；只有 Hindsight 终态才投影 completed/failed。网络错误在 Temporal
Activity 历史中记录，结果未知时继续跟踪，不改成写入终态失败。
Ops 在产品完成后仍观察已有 pending/running 的记忆或 finalization step，直到终态才停止，
不使用固定两秒补刷。失败、取消和 skipped 不使轮询永久等待。

记忆管理正文只返回给当前用户，不进入通用运行日志或 Ops 列表。已有有界模型恢复上下文仍可包含
memory excerpt；Langfuse 不新增原始记忆导出，见 [Langfuse 合同](../../contracts/langfuse-runtime.md)。
不采集 Hindsight 内部 consolidation 的第二套进度。

部署先应用允许 append 无到期登记的迁移，再发布 execution-control。
本次升级须先停止旧 execution-control Worker，再启动新 Worker，不能采用新旧版本混跑的滚动发布：
旧版本的清除逻辑不识别无到期登记。存在无到期登记时也不能直接回滚至旧版本；须先排空追加任务。
`async-memory-append-v1` 版本标记保留旧同步历史重放路径；它不接收新任务，也不作为 fallback。
旧执行全部结束且相关历史超过保留期后删除该路径。Hindsight 内置 worker 和现有 Go SDK 已支持此协议，
无需新增任务队列或升级组件。决策见 [异步记忆追加](../../../.agents/notes/implemented/bug-fix/2026-09-19-async-memory-append.md)。

## 部署与退役

本地及 staging 的旧个人记忆允许硬切：先停止相关写入，删除本环境产品 bank，再应用 memory-only
迁移并恢复服务。保留账户、会话、通知、RAG、共享对象存储和通用 Temporal 数据。
不迁移旧手工条目、来源删除命令或旧 Temporal 记忆流程；只终止明确属于个人记忆的旧流程。
执行前列明目标 bank 和工作流，避免把整个 Hindsight 服务或 Temporal namespace 当作删除目标。
本地与 staging 使用同一支持原生 curation 的 Hindsight 版本。

接口细节见 [App API 个人记忆](../../contracts/app-api/memory.md)，决策见
[Hindsight 记忆生命周期](../../../.agents/notes/implemented/architecture/2026-07-17-hindsight-lifecycle.md)。
