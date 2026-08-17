---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

## 边界

Hindsight 是当前唯一个人记忆 runtime。Qdrant 只保存机构知识；仓库不维护个人记忆 collection、
embedding、extraction prompt、dedupe/merge 或 provider-backed extraction eval。

个人记忆是 user-scoped advisory context，可用于跨会话跟进、偏好、地点、服务、别名消歧、query
framing 和措辞。它不能决定身份、授权、来源信任、工具开放或失败拒绝。

## 所有权

| 所有者 | 职责 |
| --- | --- |
| Hindsight | retain、recall、extraction、graph、dedupe/merge 和 bank lifecycle |
| execution-control | ID 派生、bank policy、SDK 调用、边界裁剪、内部命令、generation fence 和 receipt |
| Temporal | Agent Activity、append、个人记忆命令和删除检查点的 durable execution |
| app-api | 用户可见接口、生命周期、期望状态、outbox 和 PostgreSQL 产品投影 |
| agent-runtime | 在本轮可用时向模型暴露 `personal_memory_recall`，不持有 Hindsight credential |

app-api 不直连 Hindsight；agent-runtime 只调用 execution-control 的有界内部 handler，不直连
Hindsight 或暴露其原始 API。运行配置归属见 [Provider 与模型配置](../../environment/providers.md)，
本文件不复制环境变量。

## Identity 与隔离

- 产品默认 tenant 为显式 `tenant-main`；
- bank ID 从稳定 salt、tenant、user ID 和用户代次派生；
- 每条 accepted user message 对应
  `conversation:<conversation_hash>:message:<message_hash>` document ID；
- explicit profile document ID 为 `profile:<memory_id>`；
- 产品 user、conversation 和 message ID 不直接作为 Hindsight object ID；
- salt 在同一环境必须稳定，不跨环境共享。

写入操作先检查 scoped bank，仅在不存在时按固定策略创建，并启用 Memory Defense
`sensitive_data -> redact`。recall 只读取已存在的 bank；bank 不存在时返回 no-match，不创建或重配
bank。

## 在线执行

在持久回答开始时，execution-control 冻结 `recall_enabled`、`append_enabled` 和用户代次。
`recall_enabled=false` 时新运行不开放个人记忆工具；为 true 时，Primary Agent 可以按当前请求调用
一次 `personal_memory_recall`。handler 重新校验运行身份、策略和用户代次后调用 Hindsight，并返回
裁剪后的 `memory_text`。matched 结果可以支持用户自身事实或偏好，但不能支持机构事实、替代 Campus
Docs evidence、成为公开来源或改变工具集合；no-match 不能被解释为任何事实。

追加 activity 只有在 app-api 已接受同一 `finalization_fingerprint`，且 execution-control 的
`completed` run 已绑定 `completed` `finalization.write` 投影后，才以确定性文档标识同步保留已接受
的用户消息。取消、失败、过期、终态冲突或缺少该绑定时不得追加。完整阶段和队列关系由
[持久 Agent 运行时](./durable-runtime.md) 维护。

recall 使用 accepted user message 时间作为 `query_timestamp`。返回 fact 即使缺少 `occurred_*` 或
`mentioned_at` 仍可进入有界 context，此时更新时间为空。

append 使用确定性 document ID、`update_mode=replace` 和 private observation scope。Hindsight
同步返回后本次 activity 才成功；仓库不代理其内部 operation。append 失败不回滚已经完成的回答，
但必须记录 failed step 和稳定失败状态。

gate 在 chat 准入时冻结，后续执行不重读可变设置。关闭 recall 时不开放工具或创建 recall step；
开启 recall 时由 Primary Agent 按当前请求决定是否执行，单个 run 最多一次。关闭 append 时追加
activity 投影 skipped step。两者都不能从 PostgreSQL、Qdrant 或供应商抽取记忆。

## 用户管理与删除

app-api 在 PostgreSQL 中维护 lifecycle、item desired state 和 command outbox。execution-control
按用户命令序列接收命令，完成 Hindsight 修改后写入幂等 receipt；app-api 根据 receipt
更新用户可见状态。

- pause 保留当前 generation 的 bank 和 item，后续 turn 的两个 gate 均关闭；
- resume 恢复后续 turn 的召回和追加，不创建新 generation；
- item upsert/delete 使用确定性 profile document ID，删除不存在的 document 视为幂等成功；
- 账号全量清除会递增代次、拒绝旧代次、等待在途调用排空并删除上一代 bank；
- retired bank 删除并确认不存在后，产品 lifecycle 才能从 `erasing` 进入 `erased`。

兼容版本上线前已启动的 `owner_erase` history 仍 replay 旧 Langfuse trace maintenance 检查点；新命令
不进入该路径。旧 history 排空后，旧 activity 和凭据由独立清理任务退役。

conversation prune/delete 在删除产品 message 前捕获 message ID，并派生与 retain 相同的 document
ID。`DeleteDocument` 同步删除来源文档及其 memory units；后续 consolidation 由 Hindsight 内部维护，
仓库不轮询该内部过程。

## 投影与数据最小化

execution-control 可以保存 bank/document identity、generation fence 和 command receipt。浏览器、
student run-step 和 Axiom application logs 不得保存原始 bank/document/operation ID、provider payload
或 memory 正文；允许保存公共状态、计数、hash、timing 和 failure kind。

Langfuse Agent trace 可以记录实际可见工具名和有界结果状态，但不记录 Hindsight metadata、
`memory_text`、工具输入输出或模型输入输出。Hindsight 不发送新的 Langfuse trace；具体字段边界见
[Langfuse](./langfuse.md)。

## Temporal 与失败语义

- recall 工具位于同一次 Agent Activity 和 SDK run 内，不是独立 Temporal Activity；
- Agent Activity 的 timeout、cancellation 和 invocation receipt 同时约束模型与 recall 工具；
- append 位于 core activity queue，其 heartbeat、retry 和 non-retryable error 由明确 activity policy 管理；
- deterministic config、request、bank policy 和 projection error 不 retry；
- Temporal 不充当 memory database，也不保存 raw recall/retain payload；
- recall 工具失败形成失败的 SDK tool result，当前 Agent run 和 workflow 失败关闭；
- append 是回答完成后的 side effect，失败不回滚回答。

## 数据边界

- Hindsight：个人记忆图、bank 和内部操作；
- PostgreSQL `profile.*`：生命周期、期望状态、command outbox 和用户可见投影；
- Temporal：Activity、命令和删除检查点生命周期；
- 执行投影：有界 step 与结果；
- Qdrant：机构知识；
- Langfuse：可选 Agent/model/tool trace，不参与个人记忆 lifecycle。

## 禁止形态

- Hindsight MCP、原始 API 或供应商类型直接暴露给 Primary Agent；
- 调用 Hindsight reflect 形成独立的记忆推理路径；
- app-api 或 agent-runtime 直接调用 Hindsight；
- personal memory 写入 Qdrant；
- raw memory、bank 或 operation payload 进入浏览器或 model-visible tool；
- memory 影响工具/文档范围准入或授权；
- 使用 Zep 或供应商抽取维护第二条个人记忆路径。

## 相关文档

- [ADR-0058](../../decisions/adr-0058-hindsight.md)
- [ADR-0082](../../decisions/adr-0082-hindsight-lifecycle.md)
- [个人记忆接口](../../contracts/app-api/memory.md)
- [Durable runtime](./durable-runtime.md)
- [身份与授权](./identity-authz.md)
