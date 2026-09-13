---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

Hindsight 是唯一个人记忆运行时；Qdrant 只负责机构知识。记忆辅助理解个人偏好、背景与指代，
不决定身份、授权、工具开放或机构事实。聊天和记忆有独立生命周期。

所有权决策见 [ADR-0058](../../decisions/adr-0058-hindsight.md)；个人记忆与会话上下文边界见
[ADR-0015](../../decisions/adr-0015-memory-boundaries.md)。记忆不能覆盖实体识别结果，见
[ADR-0021](../../decisions/adr-0021-entity-aliases.md)。

## 所有权

| Owner | 职责 |
| --- | --- |
| Hindsight | 内容、原生事实编辑/停用/恢复、来源、派生观察、consolidation、bank 清除 |
| execution-control | bank 身份派生、SDK 适配、generation fence、在途租约、命令回执 |
| Temporal | 命令串行执行、回答后的追加与有界重试、终态投影 |
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

回答提交后才追加当前用户消息，不追加助手回答。追加使用原生同步 retain 和 private observation scope；
错误不能回滚已经完成的回答。失败/取消的产品请求不追加。

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

memory.append 在完成投影前登记 pending，Activity 开始投影 running。单次失败记入 attempt，
整体 step 在 Temporal 重试期间保持 running；重试耗尽由 workflow 记录最终 failed。
Ops 在产品完成后仍观察已有 pending/running 的记忆或 finalization step，直到终态才停止，
不使用固定两秒补刷。失败、取消和 skipped 不使轮询永久等待。

记忆管理正文只返回给当前用户，不进入通用运行日志或 Ops 列表。已有有界模型恢复上下文仍可包含
memory excerpt；Langfuse 不新增原始记忆导出，见 [Langfuse 合同](../../contracts/langfuse-runtime.md)。
不采集 Hindsight 内部 consolidation 的第二套进度。

## 部署与退役

本地及 staging 的旧个人记忆允许硬切：先停止相关写入，删除本环境产品 bank，再应用 memory-only
迁移并恢复服务。保留账户、会话、通知、RAG、共享对象存储和通用 Temporal 数据。
不迁移旧手工条目、来源删除命令或旧 Temporal 记忆流程；只终止明确属于个人记忆的旧流程。
执行前列明目标 bank 和工作流，避免把整个 Hindsight 服务或 Temporal namespace 当作删除目标。
本地与 staging 使用同一支持原生 curation 的 Hindsight 版本。

接口细节见 [App API 个人记忆](../../contracts/app-api/memory.md)，决策见
[ADR-0082](../../decisions/adr-0082-hindsight-lifecycle.md)。
